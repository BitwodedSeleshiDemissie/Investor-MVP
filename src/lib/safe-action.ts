import { createSafeActionClient } from "next-safe-action";
import { getSession } from "./auth";

export const actionClient = createSafeActionClient();

export const protectedAction = actionClient.use(async ({ next }) => {
  const session = await getSession();
  if (!session) throw new Error("Unauthorized");
  return next({ ctx: { session } });
});

export const adminAction = actionClient.use(async ({ next }) => {
  const session = await getSession();
  if (!session || session.role !== "admin") throw new Error("Forbidden");
  return next({ ctx: { session } });
});
