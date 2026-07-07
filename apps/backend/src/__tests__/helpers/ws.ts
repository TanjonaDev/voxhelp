import type WebSocket from "ws";
import type { ServerMessage } from "@voxhelp/shared";

export function waitForMessage(ws: WebSocket, type: string, timeout = 5000): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", handler);
      reject(new Error(`Timeout waiting for message type "${type}"`));
    }, timeout);

    function handler(data: Buffer) {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      if (msg.type === type) {
        clearTimeout(timer);
        ws.off("message", handler);
        resolve(msg);
      }
    }
    ws.on("message", handler);
  });
}
