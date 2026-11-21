from django.conf import settings
from django.db import models
from django.db.models import F, Q

User = settings.AUTH_USER_MODEL


class Profile(models.Model):
    class Intent(models.TextChoices):
        FRIENDSHIP = "friends", "Friendship"
        DATING = "dating", "Dating and relationships"
        CASUAL = "casual", "Casual dating"

    class Tier(models.TextChoices):
        FREE = "free", "Free"
        PLUS = "plus", "Meet Plus"
        PREMIUM = "premium", "Meet Premium"

    user = models.OneToOneField(User, on_delete=models.CASCADE)
    name = models.CharField(max_length=40)
    bio = models.CharField(max_length=300, blank=True)
    interests = models.CharField(max_length=150, blank=True)
    intention = models.CharField(max_length=10, choices=Intent.choices)
    community = models.CharField(max_length=50)
    visible = models.BooleanField(default=False)
    tier = models.CharField(max_length=10, choices=Tier.choices, default=Tier.FREE)

    @property
    def daily_likes(self):
        return {self.Tier.FREE: 10, self.Tier.PLUS: 30, self.Tier.PREMIUM: 50}[self.tier]


class Connection(models.Model):
    # Canonical ordering and one row per pair serialize all interactions.
    low = models.ForeignKey(User, on_delete=models.CASCADE, related_name="+")
    high = models.ForeignKey(User, on_delete=models.CASCADE, related_name="+")
    low_likes = models.BooleanField(default=False)
    high_likes = models.BooleanField(default=False)
    low_passed = models.BooleanField(default=False)
    high_passed = models.BooleanField(default=False)
    blocked = models.BooleanField(default=False)
    closed = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["low", "high"], name="meet_unique_pair"),
            models.CheckConstraint(condition=Q(low__lt=F("high")), name="meet_ordered_pair"),
        ]

    @property
    def matched(self):
        return self.low_likes and self.high_likes and not (self.blocked or self.closed)


class LikeEvent(models.Model):
    sender = models.ForeignKey(User, on_delete=models.CASCADE)
    created = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["sender", "created"])]


class Message(models.Model):
    connection = models.ForeignKey(Connection, on_delete=models.CASCADE)
    sender = models.ForeignKey(User, on_delete=models.CASCADE)
    body = models.CharField(max_length=500)
    created = models.DateTimeField(auto_now_add=True)
    read = models.BooleanField(default=False)

    class Meta:
        indexes = [models.Index(fields=["sender", "created"])]


class Plan(models.Model):
    class Category(models.TextChoices):
        COFFEE = "coffee", "Coffee"
        RESTAURANT = "restaurant", "Restaurants"
        GAMING = "gaming", "Gaming"
        MOVIE = "movie", "Movies"
        WALK = "walk", "Walking"
        EVENT = "event", "Public events"
        FRIENDSHIP = "friendship", "Friendship activities"

    class Status(models.TextChoices):
        PROPOSED = "proposed", "Proposed"
        ACCEPTED = "accepted", "Accepted"
        DECLINED = "declined", "Declined"
        CANCELED = "canceled", "Canceled"

    connection = models.ForeignKey(Connection, on_delete=models.CASCADE)
    sender = models.ForeignKey(User, on_delete=models.CASCADE)
    category = models.CharField(max_length=12, choices=Category.choices)
    when = models.DateTimeField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PROPOSED)


class Report(models.Model):
    class Category(models.TextChoices):
        ABUSE = "abuse", "Harassment or abuse"
        MINOR = "minor", "Suspected underage account"
        SPAM = "spam", "Spam or scam"
        OTHER = "other", "Other safety issue"

    reporter = models.ForeignKey(User, on_delete=models.CASCADE, related_name="+")
    subject = models.ForeignKey(User, on_delete=models.CASCADE, related_name="+")
    category = models.CharField(max_length=10, choices=Category.choices)
    details = models.CharField(max_length=500, blank=True)
    evidence = models.CharField(max_length=500, blank=True)
    created = models.DateTimeField(auto_now_add=True)
    resolved = models.BooleanField(default=False)
