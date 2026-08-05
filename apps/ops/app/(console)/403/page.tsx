import { PageHeader } from "@cc/ui";
import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <>
      <PageHeader
        title="Not your console"
        subtitle="Your operator account doesn't hold the capability this screen needs. The tabs in the sidebar are the ones it does."
      />
      <p className="text-[12.5px] text-text-dim">
        <Link href="/" className="text-primary hover:underline">
          Back to the console
        </Link>
      </p>
    </>
  );
}
