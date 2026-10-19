import type { Metadata } from "next";
import { FlowPage } from "../flow-page";
import { SignInFlow } from "./sign-in-flow";

export const metadata: Metadata = { title: "Sign in · Mumbai Places Diary" };

export default function SignInPage() {
  return (
    <FlowPage title="Sign in on this device" sub="Use a device you already have, your passphrase, or your recovery phrase.">
      <SignInFlow />
    </FlowPage>
  );
}
