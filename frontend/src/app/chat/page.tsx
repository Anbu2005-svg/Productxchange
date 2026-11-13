"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, User, getToken } from "@/lib/api";
import EmptyState from "@/components/ui/EmptyState";
import { MessageSquare, ChevronRight } from "lucide-react";

type Conversation = {
  id: number;
  product_id: number | null;
  user_a_id: number;
  user_b_id: number;
  created_at: string;
};

type LastMessage = {
  content: string;
  sender_id: number;
  created_at: string;
};

type ConversationDisplay = Conversation & {
  otherUser: { id: number; name: string };
  lastMessage?: LastMessage | null;
};

export default function ChatListPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [conversations, setConversations] = useState<ConversationDisplay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const token = getToken();
      if (!token) {
        router.replace("/login?redirect=/chat");
        return;
      }
      try {
        const user = await api("/auth/me").catch(() => null);
        if (!user) {
          router.replace("/login?redirect=/chat");
          return;
        }
        setCurrentUser(user);

        const convos: Conversation[] = await api("/chat/conversations");

        const displayed: ConversationDisplay[] = await Promise.all(
          convos.map(async (c) => {
            const otherId = c.user_a_id === user.id ? c.user_b_id : c.user_a_id;

            let lastMsg: LastMessage | null = null;
            try {
              const msgs = await api(`/chat/conversations/${c.id}/messages`);
              if (msgs.length > 0) {
                lastMsg = msgs[msgs.length - 1];
              }
            } catch { }

            return {
              ...c,
              otherUser: { id: otherId, name: `Student #${otherId}` },
              lastMessage: lastMsg,
            };
          })
        );

        setConversations(displayed);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router]);

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center text-xs text-text-secondary">
        Loading conversations...
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center">
        <MessageSquare className="mx-auto mb-3 h-8 w-8 text-text-tertiary" strokeWidth={1.5} />
        <h1 className="text-base font-semibold text-text">Messages</h1>
        <p className="mt-1 text-xs text-danger">{error}</p>
        <Link href="/login" className="mt-4 inline-block text-xs font-medium text-primary hover:underline">
          Log in to continue
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl py-4 sm:py-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">Messages</h1>
          <p className="text-xs text-text-secondary">
            Direct communication with campus buyers and sellers
          </p>
        </div>
      </div>

      {conversations.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="No conversations yet"
          description="Browse campus listings and message a seller to start negotiating."
          actionLabel="Browse nearby items"
          actionHref="/"
        />
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border bg-surface overflow-hidden">
          {conversations.map((c) => {
            const hasLastMsg = Boolean(c.lastMessage);
            const isMe = c.lastMessage?.sender_id === currentUser?.id;
            const dateStr = new Date(c.lastMessage?.created_at || c.created_at).toLocaleDateString(
              "en-IN",
              { month: "short", day: "numeric" }
            );

            return (
              <Link
                key={c.id}
                href={`/chat/${c.id}`}
                className="flex items-center gap-3.5 p-4 transition-colors hover:bg-surface-muted"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface-muted font-medium text-xs text-text">
                  {c.otherUser.name.charAt(0).toUpperCase()}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="truncate text-xs font-semibold text-text">
                      {c.otherUser.name}
                    </span>
                    <span className="font-mono text-[11px] tabular-nums text-text-tertiary shrink-0 ml-2">
                      {dateStr}
                    </span>
                  </div>
                  <p className="truncate text-xs text-text-secondary">
                    {hasLastMsg
                      ? `${isMe ? "You: " : ""}${c.lastMessage?.content}`
                      : "No messages yet"}
                  </p>
                </div>

                <ChevronRight className="h-4 w-4 shrink-0 text-text-tertiary" strokeWidth={1.75} />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
