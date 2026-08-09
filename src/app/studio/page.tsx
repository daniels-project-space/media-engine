import { redirect } from "next/navigation";

/** Ad Studio has been consolidated into the reviewable Work pipeline. */
export default function StudioPage() {
  redirect("/work");
}
