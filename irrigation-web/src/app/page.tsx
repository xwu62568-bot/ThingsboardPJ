import { redirect } from "next/navigation";
import { getPageUser } from "@/lib/server/session";

export default async function HomePage() {
  const user = await getPageUser();
  redirect(user ? "/devices" : "/login");
}
