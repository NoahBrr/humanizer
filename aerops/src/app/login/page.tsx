import { redirect } from "next/navigation";

/** Convenience alias: /login → /sign-in. */
export default function LoginPage() {
  redirect("/sign-in");
}
