const inbox = document.getElementById("inbox");
const status = document.getElementById("inbox-status");
const form = document.getElementById("message-form");
const report = document.getElementById("report-link");
let previous = "";

async function refresh() {
  let retry = true;
  try {
    const response = await fetch(inbox.dataset.url, {
      method: "POST",
      headers: { "X-CSRFToken": form.elements.csrfmiddlewaretoken.value },
      cache: "no-store",
    });
    if ([401, 403, 404].includes(response.status) || response.redirected) {
      status.textContent = "This conversation is no longer available.";
      inbox.replaceChildren();
      form.querySelector("button").disabled = true;
      retry = false;
      return;
    }
    if (!response.ok) throw new Error("Unable to load messages");
    const payload = await response.text();
    if (payload !== previous) {
      const { messages } = JSON.parse(payload);
      // Preserve keyboard focus on evidence links while a refresh is pending.
      if (inbox.contains(document.activeElement)) return;
      previous = payload;
      inbox.replaceChildren(...messages.map((message) => {
        const row = document.createElement("article");
        row.className = message.mine ? "bubble-message" : "bubble-message bot-bubble";
        const detail = document.createElement("small");
        detail.textContent = new Date(message.created).toLocaleString()
          + (message.mine && message.read ? " · Read" : "");
        const body = document.createElement("p");
        body.textContent = message.body;
        row.append(detail, body);
        if (!message.mine) {
          const link = document.createElement("a");
          const href = new URL(report.href);
          href.searchParams.set("message", message.id);
          link.href = href;
          link.textContent = "Report message";
          row.append(link);
        }
        return row;
      }));
      if (!messages.length) inbox.textContent = "Say hello to start your conversation.";
    }
    status.textContent = "";
  } catch {
    status.textContent = "Messages could not refresh. Retrying…";
  } finally {
    if (retry) setTimeout(refresh, 4000);
  }
}

refresh();
