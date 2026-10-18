import type { Metadata } from "next";
import { SignInFlow } from "./sign-in-flow";

export const metadata: Metadata = { title: "Sign in · Mumbai Places Diary" };

export default function SignInPage() {
  return (
    <main>
      <h1>Sign in on this device</h1>
      <SignInFlow />
    </main>
  );
}
