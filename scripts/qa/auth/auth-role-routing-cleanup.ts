import "dotenv/config";

async function main() {
  console.log(
    [
      "Auth role routing cleanup is complete.",
      "This scenario does not create persistent QA records.",
      "Close any browser windows or throwaway session files created during manual QA.",
    ].join("\n"),
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : "Unknown auth role routing cleanup error.",
  );
  throw error;
});
