import base64
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import Client, RequestFactory, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from .gate import PrivateBeta
from .models import Connection, LikeEvent, Message, Plan, Profile, Report

PASSWORD = "sample-test-password-only"


class MemberTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.alex, cls.jamie, cls.riley = [
            get_user_model().objects.create_user(name, password=PASSWORD)
            for name in ("qa-alex", "qa-jamie", "qa-riley")
        ]
        for user in (cls.alex, cls.jamie, cls.riley):
            Profile.objects.create(user=user, name=user.username, intention="friends",
                                   community="sandbox", visible=True)

    def setUp(self):
        self.a, self.b, self.c = Client(), Client(), Client()
        for client, user in zip((self.a, self.b, self.c), (self.alex, self.jamie, self.riley)):
            client.force_login(user)

    def react(self, client, peer, action):
        return client.post(reverse("react", args=[peer.pk, action]))

    def match(self):
        self.react(self.a, self.jamie, "like")
        self.react(self.b, self.alex, "like")

    def send(self, client, peer, body="Test message"):
        return client.post(reverse("send", args=[peer.pk]), {"body": body})

    def propose(self):
        return self.a.post(reverse("propose", args=[self.jamie.pk]), {
            "category": "coffee", "when": (timezone.now()+timedelta(days=1)).isoformat(),
        })

    def test_login_is_required_and_registration_closed(self):
        self.assertEqual(Client().get(reverse("discover")).status_code, 302)
        self.assertEqual(Client().post("/register/").status_code, 404)
        customer = Client()
        response = customer.post(reverse("login"), {"username": self.alex.username, "password": PASSWORD})
        self.assertRedirects(response, reverse("discover"))
        self.assertEqual(self.a.get("/admin/").status_code, 302)

    def test_discover_filters_hidden_and_ineligible_accounts(self):
        self.assertContains(self.a.get(reverse("discover")), self.jamie.username)
        self.b.post(reverse("edit_profile"), {
            "name": "Jamie", "intention": "friends", "community": " SANDBOX ",
        })
        Profile.objects.filter(user=self.riley).update(intention="dating")
        response = self.a.get(reverse("discover"))
        self.assertNotContains(response, "Jamie")
        self.assertNotContains(response, self.riley.username)
        self.assertEqual(self.react(self.a, self.jamie, "like").status_code, 404)
        self.assertEqual(self.react(self.a, self.riley, "like").status_code, 404)

    def test_mutual_consent_read_state_and_access(self):
        self.assertEqual(self.send(self.a, self.jamie).status_code, 404)
        self.react(self.a, self.jamie, "like")
        self.assertEqual(self.send(self.a, self.jamie).status_code, 404)
        self.react(self.b, self.alex, "like")
        self.assertEqual(self.send(self.c, self.alex).status_code, 404)
        self.assertEqual(self.send(self.a, self.jamie, "<script>literal</script>").status_code, 302)
        self.assertContains(self.b.get(reverse("matches")), "Unread messages")
        response = self.b.post(reverse("inbox", args=[self.alex.pk]))
        self.assertEqual(response.json()["messages"][0]["body"], "<script>literal</script>")
        self.assertTrue(Message.objects.get().read)
        self.assertNotContains(self.b.get(reverse("matches")), "Unread messages")

    def test_block_stops_both_directions_and_removes_discovery(self):
        self.match()
        self.send(self.a, self.jamie)
        self.react(self.b, self.alex, "block")
        self.assertEqual(self.send(self.a, self.jamie).status_code, 404)
        self.assertEqual(self.send(self.b, self.alex).status_code, 404)
        self.assertEqual(self.a.post(reverse("inbox", args=[self.jamie.pk])).status_code, 404)
        self.assertEqual(self.propose().status_code, 404)
        self.assertEqual(self.react(self.a, self.jamie, "like").status_code, 404)
        self.assertNotContains(self.a.get(reverse("matches")), self.jamie.username)

    def test_unmatch_stops_chat(self):
        self.match()
        self.react(self.a, self.jamie, "unmatch")
        self.assertEqual(self.send(self.b, self.alex).status_code, 404)

    def test_plan_ownership_and_transitions(self):
        self.match()
        self.assertEqual(self.propose().status_code, 302)
        plan = Plan.objects.get()
        own = reverse("plan_status", args=[self.jamie.pk, plan.pk, "accept"])
        peer = reverse("plan_status", args=[self.alex.pk, plan.pk, "accept"])
        self.assertEqual(self.a.post(own).status_code, 409)
        self.assertEqual(self.c.post(peer).status_code, 404)
        self.assertEqual(self.b.post(peer).status_code, 302)
        self.assertEqual(self.a.post(reverse("plan_status", args=[
            self.jamie.pk, plan.pk, "cancel"])).status_code, 302)
        plan.refresh_from_db()
        self.assertEqual(plan.status, Plan.Status.CANCELED)

    def test_reports_validate_evidence_and_are_admin_only(self):
        self.match()
        self.send(self.b, self.alex, "Evidence")
        payload = {"category": "abuse", "message": Message.objects.get().pk}
        self.assertEqual(self.c.post(reverse("report", args=[self.jamie.pk]), payload).status_code, 404)
        report = reverse("report", args=[self.jamie.pk])
        self.assertContains(self.a.post(report, payload), "Report recorded")
        row = Report.objects.get()
        self.assertEqual(row.evidence, "Evidence")
        admin_url = reverse("admin:member_report_change", args=[row.pk])
        self.assertEqual(self.a.get(admin_url).status_code, 302)
        admin = get_user_model().objects.create_superuser("qa-admin", password=PASSWORD)
        self.c.force_login(admin)
        self.assertContains(self.c.get(admin_url), "Evidence")
        self.c.post(admin_url, {"resolved": "on"})
        row.refresh_from_db()
        self.assertTrue(row.resolved)

    def test_delete_erases_relationship_data(self):
        self.match()
        self.send(self.a, self.jamie)
        self.propose()
        self.assertEqual(self.a.post(reverse("delete_account"), {"password": "wrong"}).status_code, 403)
        self.assertRedirects(self.a.post(reverse("delete_account"), {"password": PASSWORD}), "/")
        for model in (Connection, Message, Plan):
            self.assertFalse(model.objects.exists())
        self.assertFalse(Profile.objects.filter(user=self.alex).exists())

    def test_like_limit_and_tiers(self):
        url = reverse("react", args=[self.jamie.pk, "like"])
        LikeEvent.objects.bulk_create([LikeEvent(sender=self.alex) for _ in range(10)])
        self.assertEqual(self.a.post(url).status_code, 429)
        self.assertFalse(Connection.objects.exists())
        Profile.objects.filter(user=self.alex).update(tier="plus")
        self.assertEqual(self.a.post(url).status_code, 302)
        self.assertEqual(self.a.post(url).status_code, 302)
        self.assertEqual(LikeEvent.objects.count(), 11)

    def test_message_rate_limit_and_csrf(self):
        self.match()
        csrf = Client(enforce_csrf_checks=True)
        csrf.force_login(self.alex)
        self.assertEqual(self.send(csrf, self.jamie).status_code, 403)
        for _ in range(12):
            self.assertEqual(self.send(self.a, self.jamie).status_code, 302)
        self.assertEqual(self.send(self.a, self.jamie).status_code, 429)

    def test_demo_has_its_own_assets_and_no_member_state(self):
        demo = self.a.get(reverse("demo"))
        self.assertIn(b"bot-engine.js", b"".join(demo.streaming_content))
        demo.close()
        self.assertNotContains(self.a.get(reverse("discover")), "bot-engine.js")
        self.assertEqual(self.a.get("/demo/manage.py").status_code, 404)

    @override_settings(MEET_LOCAL=False, BETA_PASSWORD="test-private-key")
    def test_private_gate_rejects_unknown_and_malformed_credentials(self):
        from django.http import HttpResponse
        gate = PrivateBeta(lambda request: HttpResponse("allowed"))
        req = RequestFactory()
        self.assertEqual(gate(req.get("/")).status_code, 401)
        self.assertEqual(gate(req.get("/", HTTP_AUTHORIZATION="Basic @")).status_code, 401)
        credentials = base64.b64encode(b"beta:test-private-key").decode()
        self.assertEqual(gate(req.get("/", HTTP_AUTHORIZATION=f"Basic {credentials}")).status_code, 200)

    def call(self, client, peer, action, **payload):
        return client.post(reverse("call_signal", args=[peer.pk]), {
            "action": action, **payload,
        }, content_type="application/json")

    def test_call_requires_a_match_and_recipient_answer(self):
        offer = {"mode": "video", "sdp": "v=0\r\n"}
        self.assertEqual(self.call(self.a, self.jamie, "start", **offer).status_code, 404)
        self.match()
        session = self.call(self.a, self.jamie, "start", **offer).json()["call"]
        self.assertFalse(session["accepted"])
        self.assertEqual(self.call(self.b, self.alex, "start", **offer).status_code, 409)
        self.assertEqual(self.call(self.c, self.alex, "status").status_code, 404)
        incoming = self.call(self.b, self.alex, "status").json()["call"]
        self.assertEqual(incoming["offer"], offer["sdp"])
        answer = {"id": session["id"], "sdp": "v=0\r\n"}
        self.assertEqual(self.call(self.a, self.jamie, "answer", **answer).status_code, 400)
        self.assertTrue(self.call(self.b, self.alex, "answer", **answer).json()["call"]["accepted"])
        self.assertEqual(self.call(self.a, self.jamie, "status").json()["call"]["answer"], answer["sdp"])
        self.react(self.b, self.alex, "block")
        self.assertEqual(self.call(self.a, self.jamie, "status").status_code, 404)
        from .models import Call
        self.assertFalse(Call.objects.exists())

    def test_call_decline_and_hosted_relay_requirement(self):
        self.match()
        result = self.call(self.a, self.jamie, "start", mode="voice", sdp="v=0\r\n")
        session = result.json()["call"]
        self.assertIsNone(self.call(self.b, self.alex, "end", id=session["id"]).json()["call"])
        from .calls import enabled, valid_sdp
        with override_settings(MEET_LOCAL=False, MEET_TURN_URL="", MEET_TURN_SECRET=""):
            self.assertFalse(enabled())
            self.assertFalse(valid_sdp("v=0\r\na=candidate:1 1 udp 100 10.0.0.1 1234 typ host\r\n"))
