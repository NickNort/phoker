import { Spectrum, app } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
// Spectrum bridges a single agent loop to many messaging interfaces.
// Each provider in `providers` adds an interface (terminal TUI, iMessage, …).
// Docs: https://photon.codes/docs/spectrum-ts
const projectId = process.env.PROJECT_ID!;
const projectSecret = process.env.PROJECT_SECRET!;
const gameUrl = readGameUrl();

const spectrum = await Spectrum({
  projectId,
  projectSecret,
  providers: [
    // imessage
    imessage.config(),
  ],
});

await printIMessageNumber(projectId, projectSecret);

if (!gameUrl) {
  console.warn(
    "GAME_URL is unset or invalid. Inbound iMessage texts will not include the Midnight mini-app card.",
  );
}

// `spectrum.messages` is an async iterable. Each tick yields a `space` (the
// conversation) and an inbound `message`. Reply by awaiting `space.send(...)`.
for await (const [space, message] of spectrum.messages) {
  if (message.direction === "outbound") continue;
  if (message.content.type !== "text") continue;

  await space.responding(async () => {
    if (!gameUrl) {
      await message.reply(
        "Midnight isn't online yet. Set GAME_URL to the blackjack mini-app, then text me again.",
      );
      return;
    }

    await space.send(
      "Mina is dealing at Midnight. Open the table to answer her call — say hit, stand, double, or deal.",
      app(gameUrl, { live: true }),
    );
  });
}

function readGameUrl(): string | undefined {
  const value = process.env.GAME_URL?.trim();
  if (!value) return undefined;

  try {
    return new URL(value).toString();
  } catch {
    console.warn(`GAME_URL is not a valid absolute URL: ${value}`);
    return undefined;
  }
}

// Dedicated plans own a project line. Shared-pool plans assign a number per
// registered user, so we fall back to those assigned numbers.
async function printIMessageNumber(projectId: string, projectSecret: string) {
  const headers = {
    Authorization: `Basic ${Buffer.from(`${projectId}:${projectSecret}`).toString("base64")}`,
  };
  const base = `https://spectrum.photon.codes/projects/${projectId}`;

  try {
    const [lines, users] = await Promise.all([
      getJson<{ data?: { lines?: { phoneNumber?: string }[] } }>(
        `${base}/lines/?platform=imessage`,
        headers,
      ),
      getJson<{ data?: { users?: { assignedPhoneNumber?: string | null }[] } }>(
        `${base}/users/`,
        headers,
      ),
    ]);
    const numbers = [
      ...new Set(
        [
          ...(lines.data?.lines ?? []).map((line) => line.phoneNumber),
          ...(users.data?.users ?? []).map((user) => user.assignedPhoneNumber),
        ].filter((value): value is string => Boolean(value)),
      ),
    ];
    if (numbers.length > 0) {
      console.log(`iMessage: ${numbers.join(", ")}`);
      return;
    }
    console.log(
      "iMessage: no number yet. Add a user in the Photon dashboard, then restart.",
    );
  } catch (error) {
    console.warn("Could not look up iMessage number:", error);
  }
}

async function getJson<T>(url: string, headers: HeadersInit): Promise<T> {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} from ${url}`);
  }
  return (await response.json()) as T;
}
