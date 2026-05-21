import WebSocket from "ws";

const ws = new WebSocket("ws://192.168.29.92:8080");

ws.on("open", () => {
  console.log("[TEST] Connected to signaling server");

  ws.send(JSON.stringify({
    type: "register",
    from: "mac-peer"
  }));
});

ws.on("message", (data) => {
  console.log("[TEST] Message:", data.toString());
});

ws.on("close", () => {
  console.log("[TEST] Connection closed");
});
