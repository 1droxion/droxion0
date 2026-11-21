(() => {
  const panel = document.querySelector("#calling");
  const status = document.querySelector("#call-status");
  const local = document.querySelector("#call-local");
  const remote = document.querySelector("#call-remote");
  const csrf = document.querySelector("#message-form [name=csrfmiddlewaretoken]").value;
  const buttons = Object.fromEntries([...panel.querySelectorAll("button")].map(b => [b.dataset.call, b]));
  let call = null;
  let pc = null;
  let stream = null;
  let busy = false;
  let unavailable = false;
  let answered = false;

  async function signal(action, fields = {}, keepalive = false) {
    const response = await fetch(panel.dataset.url, {
      method: "POST", headers: {"Content-Type": "application/json", "X-CSRFToken": csrf},
      body: JSON.stringify({action, ...fields}), keepalive, cache: "no-store",
    });
    if (!response.ok || response.redirected) {
      if ([401, 403, 404, 503].includes(response.status) || response.redirected) unavailable = true;
      throw new Error(response.status === 409 ? "The call changed. Try again." : "Calling is unavailable.");
    }
    return response.json();
  }

  function render() {
    buttons.voice.disabled = buttons.video.disabled = busy || !!call || unavailable;
    buttons.accept.hidden = !call || call.outgoing || call.accepted;
    buttons.accept.disabled = busy;
    buttons.end.hidden = !call;
    buttons.end.disabled = busy;
    buttons.end.textContent = call && !call.outgoing && !call.accepted ? "Decline" : "End call";
  }

  function closeMedia() {
    pc?.close();
    stream?.getTracks().forEach(track => track.stop());
    pc = stream = null;
    local.srcObject = remote.srcObject = null;
    local.hidden = remote.hidden = true;
    answered = false;
  }

  async function connect(mode) {
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      throw new Error("This browser cannot use calling.");
    }
    const config = await signal("config");
    stream = await navigator.mediaDevices.getUserMedia({audio: true, video: mode === "video"});
    pc = new RTCPeerConnection(config);
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    local.srcObject = stream;
    local.hidden = mode !== "video";
    pc.ontrack = event => {
      remote.srcObject = event.streams[0];
      remote.hidden = false;
      remote.play().catch(() => { remote.controls = true; });
    };
    pc.onconnectionstatechange = () => {
      if (pc?.connectionState === "connected") status.textContent = "Call connected";
      if (pc?.connectionState === "failed") end("The call could not connect.");
    };
  }

  async function description(type) {
    await pc.setLocalDescription(type === "offer" ? await pc.createOffer() : await pc.createAnswer());
    if (pc.iceGatheringState !== "complete") {
      await new Promise((resolve, reject) => {
        const connection = pc;
        const timer = setTimeout(() => {
          connection.removeEventListener("icegatheringstatechange", done);
          reject(new Error("Could not gather a call connection."));
        }, 12000);
        function done() {
          if (connection.iceGatheringState !== "complete") return;
          clearTimeout(timer);
          connection.removeEventListener("icegatheringstatechange", done);
          resolve();
        }
        connection.addEventListener("icegatheringstatechange", done);
      });
    }
    const sdp = pc.localDescription.sdp;
    if (!sdp.includes("a=candidate:")) throw new Error("No call connection is available.");
    return sdp;
  }

  async function end(message = "Call ended") {
    const id = call?.id;
    call = null;
    closeMedia();
    status.textContent = message;
    render();
    if (id) await signal("end", {id}).catch(() => {});
  }

  async function action(kind) {
    busy = true;
    render();
    try {
      if (kind === "end") {
        await end();
      } else if (kind === "accept") {
        await connect(call.mode);
        await pc.setRemoteDescription({type: "offer", sdp: call.offer});
        const sdp = await description("answer");
        ({call} = await signal("answer", {id: call.id, sdp}));
        status.textContent = "Connecting…";
      } else {
        status.textContent = "Preparing call…";
        await connect(kind);
        const sdp = await description("offer");
        ({call} = await signal("start", {sdp, mode: kind}));
        status.textContent = "Waiting for an answer…";
      }
    } catch (error) {
      await end(error.name === "NotAllowedError" ? "Microphone or camera permission was declined." : error.message);
    } finally {
      busy = false;
      render();
    }
  }

  async function poll() {
    try {
      if (!busy) {
        const {call: next} = await signal("status");
        if (busy) return;
        if (call && next?.id !== call.id) {
          closeMedia();
          status.textContent = "Call ended";
        }
        call = next;
        if (call && !pc) {
          if (call.accepted || call.outgoing) await end();
          else status.textContent = call.mode === "video" ? "Incoming video call" : "Incoming voice call";
        } else if (call?.accepted && pc) {
          if (call.outgoing && !answered) {
            await pc.setRemoteDescription({type: "answer", sdp: call.answer});
            answered = true;
            status.textContent = "Connecting…";
          }
          await signal("touch", {id: call.id});
        }
        render();
      }
    } catch {
      if (call || pc) await end("Call disconnected.");
      render();
    } finally {
      if (!unavailable) setTimeout(poll, 3000);
    }
  }

  Object.entries(buttons).forEach(([kind, button]) => {
    button.addEventListener("click", () => action(kind));
  });
  window.addEventListener("pagehide", () => {
    if (call && pc) signal("end", {id: call.id}, true).catch(() => {});
    closeMedia();
  });
  poll();
})();
