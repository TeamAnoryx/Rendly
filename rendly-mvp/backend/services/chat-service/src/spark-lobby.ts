/**
 * Spark lobby presence: who has the Spark page open right now. A socket emits `spark:lobby`
 * with `{ present: true }` when the page opens and `{ present: false }` when it closes; every
 * socket in the lobby hears `spark:lobby-count` whenever the number of people changes.
 * Counting is per person (a user with two tabs counts once) and pure, so it is unit tested.
 */

import type { Server, Socket } from "socket.io";

export const SPARK_LOBBY_ROOM = "spark:lobby";

export type SparkLobby = {
  /** Mark one socket as on the page. Returns true when the number of people changed. */
  enter(userId: string, socketId: string): boolean;
  /** Mark one socket as off the page (closed, navigated, disconnected). */
  leave(userId: string, socketId: string): boolean;
  /** Number of distinct people on the page. */
  count(): number;
};

export function createSparkLobby(): SparkLobby {
  const sockets = new Map<string, Set<string>>();
  return {
    enter(userId, socketId) {
      const set = sockets.get(userId);
      if (set) {
        set.add(socketId);
        return false;
      }
      sockets.set(userId, new Set([socketId]));
      return true;
    },
    leave(userId, socketId) {
      const set = sockets.get(userId);
      if (!set || !set.delete(socketId)) return false;
      if (set.size > 0) return false;
      sockets.delete(userId);
      return true;
    },
    count: () => sockets.size,
  };
}

const lobby = createSparkLobby();

function broadcast(io: Server): void {
  io.to(SPARK_LOBBY_ROOM).emit("spark:lobby-count", { count: lobby.count() });
}

type Ack = (res: { ok: boolean; count: number }) => void;

/** Wire one socket into the Spark lobby. */
export function attachSparkLobby(io: Server, socket: Socket, userId: string): void {
  const leave = () => {
    socket.leave(SPARK_LOBBY_ROOM);
    if (lobby.leave(userId, socket.id)) broadcast(io);
  };

  socket.on("spark:lobby", (data: { present?: unknown } | undefined, ack?: unknown) => {
    const reply: Ack = typeof ack === "function" ? (ack as Ack) : () => undefined;
    if (data?.present === true) {
      socket.join(SPARK_LOBBY_ROOM);
      if (lobby.enter(userId, socket.id)) broadcast(io);
    } else {
      leave();
    }
    reply({ ok: true, count: lobby.count() });
  });

  socket.on("disconnect", leave);
}
