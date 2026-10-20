import RecoveryConfirmation from "./recovery-confirmation";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ConfirmAuthPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const tokenHash = typeof params.token_hash === "string" ? params.token_hash : "";
  const isRecovery = params.type === "recovery";

  return <RecoveryConfirmation tokenHash={isRecovery ? tokenHash : ""} />;
}
