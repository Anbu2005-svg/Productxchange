"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api, User, getToken, API_BASE, Product, resolveImageUrl } from "@/lib/api";
import {
  ArrowLeft,
  Send,
  Loader2,
  Package,
  ExternalLink,
} from "lucide-react";

type Message = {
  id: number;
  conversation_id: number;
  sender_id: number;
  content: string;
  image_url: string | null;
  created_at: string;
};

type ConversationInfo = {
  id: number;
  product_id: number | null;
  user_a_id: number;
  user_b_id: number;
  other_user_name?: string | null;
  other_user_avatar?: string | null;
  other_user_college?: string | null;
};

export default function ChatThreadPage() {
  const router = useRouter();
  const { id: conversationId } = useParams<{ id: string }>();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [convo, setConvo] = useState<ConversationInfo | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isWsConnected, setIsWsConnected] = useState(false);
  const [isOtherTyping, setIsOtherTyping] = useState(false);

  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentRef = useRef<number>(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const fetchMessages = useCallback(async () => {
    try {
      const msgs = await api(`/chat/conversations/${conversationId}/messages`);
      setMessages(msgs);
    } catch { }
  }, [conversationId]);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      router.replace(`/login?redirect=/chat/${conversationId}`);
      return;
    }

    async function load() {
      try {
        const user = await api("/auth/me");
        setCurrentUser(user);

        const thisConvo: ConversationInfo = await api(`/chat/conversations/${conversationId}`).catch(() => null);
        setConvo(thisConvo || null);

        if (thisConvo?.product_id) {
          api(`/products/${thisConvo.product_id}`)
            .then((p) => setProduct(p))
            .catch(() => { });
        }

        await fetchMessages();
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();

    let ws: WebSocket | null = null;
    let reconnectTimer: any = null;

    function connectWs() {
      if (!token || !conversationId) return;
      try {
        const apiBase = API_BASE;
        const wsProto = apiBase.startsWith("https") ? "wss" : "ws";
        const wsHost = apiBase.replace(/^https?:\/\//, "");
        const wsUrl = `${wsProto}://${wsHost}/chat/ws/${conversationId}`;

        ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          setIsWsConnected(true);
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            if (data.type === "typing") {
              if (currentUser && data.sender_id !== currentUser.id) {
                setIsOtherTyping(data.is_typing);
                if (data.is_typing) {
                  if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
                  typingTimeoutRef.current = setTimeout(() => setIsOtherTyping(false), 3000);
                }
              }
              return;
            }

            if (data.id && data.conversation_id === Number(conversationId)) {
              setMessages((prev) => {
                if (prev.some((m) => m.id === data.id)) return prev;
                return [...prev, data];
              });
            }
          } catch { }
        };

        ws.onclose = () => {
          setIsWsConnected(false);
          reconnectTimer = setTimeout(connectWs, 4000);
        };

        ws.onerror = () => {
          ws?.close();
        };
      } catch {
        setIsWsConnected(false);
      }
    }

    connectWs();

    pollRef.current = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
      fetchMessages();
    }, 15000);

    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        fetchMessages();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, [conversationId, fetchMessages, router]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!newMessage.trim() || sending) return;

    setSending(true);
    const content = newMessage.trim();
    try {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ content }));
        setNewMessage("");
      } else {
        await api(`/chat/conversations/${conversationId}/messages`, {
          method: "POST",
          body: JSON.stringify({ content }),
        });
        setNewMessage("");
        await fetchMessages();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl py-16 text-center text-xs text-text-secondary">
        Loading conversation...
      </div>
    );
  }

  if (error && messages.length === 0) {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center">
        <p className="text-xs text-danger">{error}</p>
        <Link href="/chat" className="mt-3 inline-block text-xs font-medium text-primary hover:underline">
          Return to messages
        </Link>
      </div>
    );
  }

  const otherUserId = convo
    ? convo.user_a_id === currentUser?.id
      ? convo.user_b_id
      : convo.user_a_id
    : null;

  const otherUserName = convo?.other_user_name || (otherUserId ? `Student #${otherUserId}` : "Chat");

  return (
    <div className="mx-auto flex h-[calc(100dvh-72px)] max-w-2xl flex-col py-2">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border bg-surface px-3 py-2.5 sm:px-4">
        <Link
          href="/chat"
          className="flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-muted hover:text-text"
          aria-label="Back to conversations"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
        </Link>

        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-surface-muted text-xs font-medium text-text">
          {otherUserName.charAt(0).toUpperCase()}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-xs font-semibold text-text">
              {otherUserName}
            </span>
            {convo?.other_user_college && (
              <span className="hidden truncate text-[11px] text-text-tertiary sm:inline">
                • {convo.other_user_college}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-text-tertiary">
          <span
            className={`h-2 w-2 rounded-full ${isWsConnected ? "bg-success" : "bg-warning"
              }`}
          />
          <span className="hidden sm:inline">
            {isWsConnected ? "Live" : "Connecting"}
          </span>
        </div>
      </div>

      {/* Pinned Deal Summary Strip */}
      {product && (
        <div className="flex items-center justify-between gap-3 border-b border-border bg-surface-muted px-4 py-2 text-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-surface">
              {product.image_urls?.[0] ? (
                <img
                  src={resolveImageUrl(product.image_urls[0])}
                  alt={product.title}
                  className="h-full w-full object-cover"
                />
              ) : (
                <Package className="h-4 w-4 text-text-tertiary" strokeWidth={1.5} />
              )}
            </div>
            <div className="min-w-0">
              <span className="truncate block font-medium text-text">
                {product.title}
              </span>
              <span className="font-mono tabular-nums text-text-secondary text-[11px]">
                {product.price != null
                  ? `₹${new Intl.NumberFormat("en-IN").format(product.price)}`
                  : "Free"}
              </span>
            </div>
          </div>

          <Link
            href={`/listings/${product.id}`}
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline shrink-0"
          >
            <span>View listing</span>
            <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
          </Link>
        </div>
      )}

      {/* Messages Thread */}
      <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-4 space-y-3">
        {messages.length === 0 && (
          <div className="py-12 text-center text-xs text-text-tertiary">
            No messages yet. Send a message to start negotiating.
          </div>
        )}

        {messages.map((msg, idx) => {
          const isMe = msg.sender_id === currentUser?.id;
          const showTime =
            idx === 0 ||
            new Date(msg.created_at).getTime() - new Date(messages[idx - 1].created_at).getTime() > 300000;

          return (
            <div key={msg.id}>
              {showTime && (
                <div className="my-3 text-center">
                  <span className="font-mono text-[11px] tabular-nums text-text-tertiary">
                    {new Date(msg.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              )}
              <div className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] sm:max-w-[70%] rounded-md px-3.5 py-2 text-sm leading-relaxed ${isMe
                    ? "bg-primary-subtle text-text border border-primary/20"
                    : "bg-surface-muted text-text border border-border"
                    }`}
                >
                  {msg.content}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Typing Indicator */}
      {isOtherTyping && (
        <div className="px-4 py-1 text-xs italic text-text-tertiary">
          {otherUserName} is typing...
        </div>
      )}

      {/* Fixed Composer */}
      <form
        onSubmit={handleSend}
        className="flex items-center gap-2 border-t border-border bg-surface p-3"
      >
        <input
          type="text"
          className="flex-1 rounded-md border border-border bg-surface px-3 py-2 text-base text-text placeholder:text-text-tertiary focus:border-primary focus:outline-hidden"
          placeholder="Write a message..."
          value={newMessage}
          onChange={(e) => {
            setNewMessage(e.target.value);
            const now = Date.now();
            if (now - lastTypingSentRef.current > 2000) {
              lastTypingSentRef.current = now;
              if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: "typing", is_typing: true }));
              }
            }
          }}
        />
        <button
          type="submit"
          disabled={!newMessage.trim() || sending}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary text-on-primary transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-tertiary"
          aria-label="Send message"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
          ) : (
            <Send className="h-4 w-4" strokeWidth={1.75} />
          )}
        </button>
      </form>
    </div>
  );
}
