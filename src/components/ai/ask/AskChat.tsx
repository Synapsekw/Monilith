"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  appendUserMessage,
  createConversation,
  recoverConversation,
  setConversationAgent,
} from "@/lib/ai/ask/conversation-actions";
import {
  applyAskProposal,
  cancelAskProposal,
} from "@/lib/ai/ask/proposal-actions";
import { PROPOSAL_FALLBACK_ANSWER } from "@/lib/ai/ask/stream-protocol";
import { useApplyBoardEffects } from "@/lib/boards/use-ai-effects";
import type { ValidatedAction } from "@/lib/ai/write/schema";
import { useAskStream } from "./use-ask-stream";
import { MessageList, type UIMessage } from "./MessageList";
import { ThreadHeader } from "./ThreadHeader";
import { ProposalCard } from "@/components/agents/ProposalCard";
import type { PendingProposal } from "@/lib/agents/proposal-display";
import type { DropState } from "./StreamDropNotice";
import type { MentionTarget } from "@/lib/collaboration/mentions";
import { Composer } from "./Composer";
import type { ChatSurface } from "./surface";

/**
 * Client controller for a single chat surface.
 *
 * Data-fetching budget (working agreement #5): sending in an existing thread and
 * streaming tokens are 0-RSC-navigation — token deltas append to client state
 * only. Starting a NEW chat rewrites the URL via `history.pushState` (no RSC
 * re-run). Send / rename / delete are Server Actions; switching to another
 * thread (from the rail) is a legitimate RSC load of *different* data. After a
 * completed turn we `router.refresh()` once so the rail picks up a new
 * auto-title.
 *
 * Phase 2: a turn can end at a confirm card. The `proposal` event arrives before
 * the message is persisted, so its actions are stashed and bound to the real
 * `assistantMessageId` at `done`. Approve/Cancel are Server Actions that take
 * only ids — the actions themselves are re-read server-side from the message
 * row through RLS — and their outcome turn is appended to client state, so
 * confirming costs exactly ONE round-trip and zero RSC navigations.
 *
 * A turn is ATOMIC from the user's side (gotcha-62): submit opens the working
 * state immediately and takes the composer with it, and only `done` / `error` /
 * a finished drop-recovery gives it back. Blocking beats cancel-and-restart
 * here because a turn that the client walks away from is not free — it is a
 * paid model call that may still land in `ai_messages` — so the cheap outcome
 * is to never start the second one.
 *
 * A turn's stream can also end ABNORMALLY — no `done`, no `error`, just a dead
 * body (flaky mobile, a dev-server rebuild). That used to render nothing at all
 * while the answer sat persisted server-side (gotcha-61). Now it triggers one
 * automatic `recoverConversation` read — the hard refresh that fixed it, minus
 * the refresh — and, if the turn genuinely hasn't landed yet, a notice the user
 * can retry from.
 *
 * SURFACE-AGNOSTIC. `/ask` owns a whole route, so it rewrites the URL and
 * refreshes the rail; the board dock owns a panel inside someone else's page,
 * where both of those are wrong. The two hardcoded behaviours are therefore
 * injectable (`onStarted`, `onTurnComplete`) and default to the `/ask` ones.
 */
/** Stable empty default — a fresh `[]` would give the prop a new identity on
 *  every render of the surfaces that have no agents to offer. */
const NO_AGENTS: readonly MentionTarget[] = [];

export function AskChat({
  conversationId,
  initialMessages,
  boardId,
  agentId,
  initialAgentId,
  title,
  agents = NO_AGENTS,
  agentNames,
  agentProposals = [],
  readOnly = false,
  onStarted,
  onTurnComplete,
  surface = "card",
  onBusyChange,
}: {
  conversationId: string | null;
  initialMessages: UIMessage[];
  /** Undecided proposals from the agent run that wrote this thread, read
   *  server-side on first paint. Empty for every ordinary chat, which is why
   *  the block below renders nothing at all rather than an empty container.
   *  Deciding one is a Server Action that flips the card in place — no refetch
   *  and no navigation (working agreement #5). */
  agentProposals?: PendingProposal[];
  /** Board this thread belongs to. Set by the dock; absent on /ask. */
  boardId?: string;
  /** Persona for a thread that does not exist yet (the dock's chosen default
   *  for a NEW board thread). Folded into the live persona state below on
   *  mount — after that this prop is never read again, because the state (and
   *  the header switcher, where one is rendered) is what decides. */
  agentId?: string;
  /** The thread's persona as of first paint, for an EXISTING conversation
   *  (`getConversationHeader`). Absent for a brand-new thread. */
  initialAgentId?: string | null;
  /** The thread's title. `/ask` (new chat) passes the static "New chat"; the
   *  existing-conversation page passes the real `ai_conversations.title` (also
   *  via `getConversationHeader`). Absent only for a row whose title read came
   *  back null (never true in practice — every row is created with a title —
   *  but the read degrades rather than throwing), in which case `ThreadHeader`
   *  falls back to a neutral placeholder rather than going titleless. */
  title?: string;
  /** The owner's agents, so a message can ADDRESS one by `@handle`, and so the
   *  header switcher (when rendered) has something to switch to. Loaded on
   *  first paint and filtered in the composer — typing a handle costs no server
   *  round-trip (working agreement #5). A handle that leads the first message
   *  wins over the current persona: it is the more explicit of the two. */
  agents?: readonly MentionTarget[];
  /** Names for agents that already answered in this thread, including ones
   *  since DISABLED. Kept separate from `agents` on purpose: the roster is
   *  enabled-only (it drives the switcher and `@handle` addressing), but
   *  disabling an agent must not relabel the answers it already gave. */
  agentNames?: Readonly<Record<string, string>>;
  /** This thread was shared to a board and the viewer does not own it. The
   *  transcript reads; every write affordance — the switcher, the composer,
   *  Approve/Cancel — is withheld, because RLS scopes all three to the owner
   *  and a control that can only fail is worse than no control. */
  readOnly?: boolean;
  /** Called with the new id instead of rewriting the URL to /ask/<id>. */
  onStarted?: (conversationId: string) => void;
  /** Called instead of router.refresh() when a turn completes. The dock uses
   *  this to update its own thread list; refreshing would re-run the board's
   *  server query for data the client already has (gotcha-09). */
  onTurnComplete?: () => void;
  /** `card` (/ask, default) or `atmosphere` (the board dock, on the wash).
   *  Threaded to `MessageList` and `Composer`; see `surface.ts`. */
  surface?: ChatSurface;
  /** `true` the moment a turn is accepted (before the first Server Action),
   *  `false` when it settles on ANY path — done, error, refused send, drop
   *  recovery. The dock reads it for the answering agent's presence dot. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<UIMessage[]>(initialMessages);
  const [streamText, setStreamText] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // The live conversation id. The prop is null on /ask until the first send
  // mints one — without tracking it here, Approve on a first-turn proposal
  // would have no conversation to address.
  const [activeId, setActiveId] = useState<string | null>(conversationId);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dropState, setDropState] = useState<DropState>("none");
  // The live persona — who is currently on duty. `initialAgentId` (an EXISTING
  // thread's column) wins over `agentId` (a NEW thread's chosen default from
  // the dock); the two are never both set. From here on this state is the
  // single source of truth: the header switcher reads and writes it, `onSubmit`
  // sends it to `createConversation`, and a successful send/switch is what
  // moves it — never a prop, which only ever seeds it once, at mount.
  const [personaId, setPersonaId] = useState<string | null>(
    initialAgentId ?? agentId ?? null,
  );
  const [, startTransition] = useTransition();
  const { streaming, send } = useAskStream();
  // Renders an approved write on a mounted board with no round-trip. A no-op
  // on /ask (no board cache) and for a board the user isn't viewing, so it
  // needs no guard here.
  const applyBoardEffects = useApplyBoardEffects();

  /**
   * ONE turn at a time, owned HERE rather than by the network layer.
   *
   * The composer used to be gated on `streaming`, which `useAskStream` only
   * raises once the fetch starts — so the whole createConversation /
   * appendUserMessage round-trip that PRECEDES the stream was an open window in
   * which a second submit could start a second, concurrent turn (gotcha-62).
   *
   * A ref, not state, because two submits can land in the same tick, before
   * React has re-rendered the composer with the new `disabled`. `turnBusy`
   * mirrors it for rendering; the ref is what actually decides.
   */
  const turnInFlight = useRef(false);
  const [turnBusy, setTurnBusy] = useState(false);

  // The composer's error surface: distinct from `status` above, which
  // narrates an IN-FLIGHT turn (the muted line under the thinking indicator).
  // This is the composer refusing to have sent anything — the
  // `createConversation`/`appendUserMessage` Server Action itself failing,
  // before any stream ever opened. `lastFailedSubmit` is a ref (not state)
  // because it is read only from the retry handler, never rendered directly.
  const [composerError, setComposerError] = useState<string | null>(null);
  const lastFailedSubmit = useRef<{
    text: string;
    agentId: string | null;
  } | null>(null);

  /**
   * The stream died mid-turn. Re-read the thread: the assistant turn has very
   * often already been persisted, in which case the user gets their real answer
   * (proposal card and all) instead of silence. One bounded, indexed, read-only
   * round-trip — cheap and idempotent enough to run without asking.
   *
   * "Did it land?" is one predicate: threads always end on the assistant's turn
   * once it exists, because the user's turn is persisted before the stream opens.
   */
  async function recoverAfterDrop(convId: string) {
    setStreamText(null);
    setStatus(null);
    setDropState("checking");
    const res = await recoverConversation({ conversationId: convId });
    if (res.ok && res.data.messages.at(-1)?.role === "assistant") {
      setMessages(res.data.messages);
      setDropState("recovered");
      // The turn may have auto-titled the thread. Same substitution as `done`:
      // a surface that owns its own list updates it itself.
      if (onTurnComplete) onTurnComplete();
      else router.refresh();
    } else {
      setDropState("unrecovered");
    }
  }

  async function onSubmit(text: string, addressedAgentId: string | null) {
    // The hard guard. Everything below — including two awaited Server Actions —
    // is part of ONE turn, and a second one may not start inside it.
    if (turnInFlight.current) return;
    turnInFlight.current = true;
    setTurnBusy(true);
    onBusyChange?.(true);
    try {
      let convId = activeId;
      setDropState("none");
      // A new send attempt — including a retry — clears the previous one's
      // alert immediately, whether or not this attempt also fails.
      setComposerError(null);
      const tmpId = `tmp-${Date.now()}`;
      setMessages((m) => [...m, { id: tmpId, role: "user", content: text }]);
      // Open the working state NOW, not when the first byte arrives: minting
      // the conversation / appending the user turn are round-trips of their
      // own, and silence during them is the same lie as silence during the
      // tool loop. `""` means "a turn is open with no tokens yet".
      setStreamText("");
      setStatus(null);

      // The turn's resolved persona — set from whichever branch below actually
      // ran, so the `done` handler can stamp the assistant row with WHO
      // answered instead of leaving `agentId` unset (which reads as
      // "Monolith" the instant the turn lands, even when a real agent
      // answered live — the streaming bubble already showed the right name).
      let turnAgentId: string | null = null;

      if (!convId) {
        // The typed handle beats the surface's default persona — chosen either
        // from the dock's `agentId` prop or from the header switcher, both
        // folded into `personaId` — because the user said who to ask in this
        // very message.
        const persona = addressedAgentId ?? personaId;
        const res = await createConversation({
          firstMessage: text,
          ...(boardId ? { boardId } : {}),
          ...(persona ? { agentId: persona } : {}),
        });
        if (!res.ok) {
          setStreamText(null);
          // Nothing was sent — roll back the optimistic bubble rather than
          // leaving an orphaned question with no answer in the transcript.
          setMessages((m) => m.filter((msg) => msg.id !== tmpId));
          lastFailedSubmit.current = { text, agentId: addressedAgentId };
          setComposerError(res.error);
          return;
        }
        convId = res.data.conversationId;
        turnAgentId = res.data.agentId;
        setActiveId(convId);
        setPersonaId(res.data.agentId);
        if (onStarted) onStarted(convId);
        // Client nav — no RSC refetch (working agreement #5).
        else window.history.pushState(null, "", `/ask/${convId}`);
      } else {
        const res = await appendUserMessage({
          conversationId: convId,
          content: text,
        });
        if (!res.ok) {
          setStreamText(null);
          setMessages((m) => m.filter((msg) => msg.id !== tmpId));
          lastFailedSubmit.current = { text, agentId: addressedAgentId };
          setComposerError(res.error);
          return;
        }
        turnAgentId = res.data.agentId;
        setPersonaId(res.data.agentId);
      }

      // Accumulate streamed tokens and any proposal in closure locals so the
      // `done` handler sees both regardless of React's render batching.
      let acc = "";
      let proposed: ValidatedAction[] = [];
      const outcome = await send(convId, (e) => {
        if (e.type === "token") {
          acc += e.text;
          setStreamText(acc);
        } else if (e.type === "status") {
          setStatus(e.text);
        } else if (e.type === "proposal") {
          proposed = e.actions;
        } else if (e.type === "error") {
          setStatus(e.message);
          setStreamText(null);
        } else if (e.type === "done") {
          setMessages((m) => [
            ...m,
            {
              id: e.assistantMessageId || `a-${Date.now()}`,
              role: "assistant",
              content: acc || (proposed.length ? PROPOSAL_FALLBACK_ANSWER : ""),
              trace: proposed.length
                ? {
                    boardsConsulted: e.boardsConsulted,
                    proposedActions: proposed,
                  }
                : null,
              agentId: turnAgentId,
            },
          ]);
          setStreamText(null);
          setStatus(null);
          if (onTurnComplete) onTurnComplete();
          else router.refresh(); // refresh rail (titles) once, after completion
        }
      });

      if (outcome === "dropped") await recoverAfterDrop(convId);
    } finally {
      // Released on every path — a stuck flag would strand the composer, which
      // is the failure mode this guard exists to avoid, not to create. The
      // surface hears the same release, so a presence dot can never stick.
      turnInFlight.current = false;
      setTurnBusy(false);
      onBusyChange?.(false);
    }
  }

  /** Resends the exact (text, agentId) `onSubmit` last failed on — the
   *  composer's Retry button. A no-op if nothing has failed (or a later send
   *  already cleared it), so it is safe to hand to `Composer` unconditionally. */
  function retryLastSend() {
    const last = lastFailedSubmit.current;
    if (!last) return;
    void onSubmit(last.text, last.agentId);
  }

  /**
   * The header switcher's only entry point. Updates the chip immediately —
   * the switch reads as instant — then, if there is a real conversation to
   * write to, persists it with the ONE targeted Server Action
   * `setConversationAgent` (working agreement #5: no navigation, no
   * `router.refresh()`). A not-yet-minted chat has no row to write to, so the
   * choice just sits in `personaId` until `onSubmit` hands it to
   * `createConversation`.
   */
  function handleAgentChange(next: string | null) {
    const previous = personaId;
    setPersonaId(next);
    if (!activeId) return;
    startTransition(async () => {
      const res = await setConversationAgent({
        conversationId: activeId,
        agentId: next,
      });
      if (!res.ok) {
        setPersonaId(previous);
        setStatus(res.error);
      }
    });
  }

  /** Approve or decline a proposal. Both append the server's outcome turn,
   *  which is what flips the card out of `idle` (see resolveProposalStates). */
  function resolve(messageId: string, approve: boolean) {
    if (!activeId || busyId) return;
    setBusyId(messageId);
    setStatus(null);
    startTransition(async () => {
      const action = approve ? applyAskProposal : cancelAskProposal;
      const res = await action({ conversationId: activeId, messageId });
      setBusyId(null);
      if (!res.ok) {
        setStatus(res.error);
        return;
      }
      applyBoardEffects(res.data.effects);
      setMessages((m) => [
        ...m,
        {
          id: res.data.messageId,
          role: "assistant",
          content: res.data.content,
          trace: res.data.trace,
          // WHO the server actually stamped on the persisted row — never a
          // second, client-side guess. `personaId` and the server's resolution
          // disagree the moment the header switches between the proposal and
          // the approval, and then a reload would silently relabel the turn.
          agentId: res.data.agentId,
        },
      ]);
    });
  }

  return (
    <div className="flex h-full flex-col">
      {/* The board dock owns its own header (thread list + share toggle) and
          renders this component inside a panel on someone else's page — a
          title and a persona switcher here would be a second, conflicting
          header. `boardId` is the reliable guard: the dock always sets it and
          the two /ask surfaces never do, so this can never fire in the dock
          regardless of agents or thread state. Beyond that, the switcher earns
          its place on screen only once there is something to switch: the
          owner has agents to offer, or a real thread already exists to name a
          persona for. */}
      {!boardId && (agents.length > 0 || activeId !== null) ? (
        <ThreadHeader
          title={title ?? "Conversation"}
          agents={agents}
          agentId={personaId}
          onAgentChange={handleAgentChange}
          readOnly={readOnly}
        />
      ) : null}
      <MessageList
        messages={messages}
        streamingText={streamText}
        status={status}
        busyMessageId={busyId}
        onApprove={(id) => resolve(id, true)}
        onCancel={(id) => resolve(id, false)}
        dropState={dropState}
        onRetryDrop={() => {
          if (activeId) void recoverAfterDrop(activeId);
        }}
        agents={agents}
        agentNames={agentNames}
        streamingAgentId={personaId}
        readOnly={readOnly}
        surface={surface}
      />
      {/* The run's queued approvals, between the report and the composer: the
          owner reads what the agent did, then decides what it could not. */}
      {agentProposals.length > 0 ? (
        <div
          className={
            surface === "card"
              ? "flex flex-col gap-2 px-4 pb-2"
              : // On the wash every other block — title row, ledger, transcript,
                // notice, error banner — is `px-3.5`; `px-4` left the cards 2px
                // out of the column.
                "flex flex-col gap-2 px-3.5 pb-2"
          }
        >
          {agentProposals.map((p) => (
            <ProposalCard key={p.id} proposal={p} />
          ))}
        </div>
      ) : null}
      {/* Never stranded: the composer is dead only while a turn or a recovery
          check is genuinely in flight — but for ALL of a turn, `turnBusy`
          covering the pre-stream round-trips that `streaming` misses. A viewer
          of someone else's shared thread gets no composer at all: /api/ask
          answers 403 for a turn on a thread the caller does not own, so a
          field that only produces a refusal is a lie about what they can do
          (the board dock says the same sentence, for the same reason). */}
      {readOnly ? (
        <p
          className={
            surface === "card"
              ? "text-muted-foreground border-t px-4 py-3 text-sm"
              : "text-muted-foreground px-3.5 py-3 text-sm"
          }
        >
          This thread was shared with the board. You can read it, but only its
          owner can reply.
        </p>
      ) : (
        <Composer
          disabled={turnBusy || streaming || dropState === "checking"}
          agents={agents}
          agentId={personaId}
          error={composerError}
          onRetry={retryLastSend}
          onSubmit={onSubmit}
          surface={surface}
        />
      )}
    </div>
  );
}
