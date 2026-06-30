import { memo, useRef } from "react";
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Virtuoso } from "react-virtuoso";
import { fadeSlideUp, getReducedVariant } from "@/lib/motion";

type Message = {
  id: string;
  senderId: string;
  content: string;
  contentType: string;
  sendTime: string;
};

type IMMessageListProps = {
  messages: Message[];
  humanAgentId?: string | null;
  agentRoleById: Map<string, string>;
  fmtTime: (iso: string) => string;
  renderContent: (content: string, contentType: string, message?: Message) => ReactNode;
  cx: (...classes: Array<string | false | undefined | null>) => string;
};

function getAvatarClass(role: string): string {
  if (role === "human") return "user-av";
  if (role === "coordinator" || role === "productmanager" || role === "pm" || role === "manager") return "coord-av";
  if (role === "worker" || role === "researcher" || role === "specialist" || role === "coder" || role === "developer" || role === "assistant") return "worker-av";
  return "coord-av";
}

function getAvatarLabel(role: string): string {
  if (role === "human") return "H";
  if (role === "assistant") return "A";
  if (role === "coordinator" || role === "productmanager" || role === "pm" || role === "manager") return "C";
  if (role === "worker") return "W";
  if (role === "researcher") return "R";
  if (role === "specialist") return "S";
  if (role === "coder" || role === "developer") return "</>";
  if (role === "creator") return "Cr";
  if (role === "editor") return "Ed";
  if (role === "reviewer") return "Rv";
  return role.slice(0, 2).toUpperCase();
}

function getRoleName(role: string): string {
  if (role === "human") return "Human";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function getAgentRole(senderId: string, agentRoleById: Map<string, string>, isMe: boolean): string {
  if (isMe) return "human";
  return agentRoleById.get(senderId) ?? senderId.slice(0, 8);
}

// Memoized per-message component - prevents Streamdown re-parse for unchanged messages
const MessageItem = memo(function MessageItem({
  m,
  humanAgentId,
  agentRoleById,
  fmtTime,
  renderContent,
  cx,
  isNew,
}: {
  m: Message;
  humanAgentId?: string | null;
  agentRoleById: Map<string, string>;
  fmtTime: (iso: string) => string;
  renderContent: (content: string, contentType: string, message?: Message) => ReactNode;
  cx: (...classes: Array<string | false | undefined | null>) => string;
  isNew: boolean;
}) {
  const isMe = m.senderId === humanAgentId;
  const senderRole = getAgentRole(m.senderId, agentRoleById, isMe);
  const avClass = getAvatarClass(senderRole);
  const avLabel = getAvatarLabel(senderRole);
  const roleName = getRoleName(senderRole);
  const isSystem = m.contentType === 'system' || senderRole === 'system';
  const shouldReduce = useReducedMotion();
  const variants = shouldReduce ? getReducedVariant(fadeSlideUp) : fadeSlideUp;

  return (
    <motion.div
      className={cx(
        'msg',
        isMe ? 'user' : 'agent',
        isSystem && 'system-msg',
      )}
      variants={variants}
      initial={isNew ? "hidden" : false}
      animate="visible"
    >
      <div className='msg-sender'>
        {!isMe ? (
          <span className={cx('avatar', avClass)}>{avLabel}</span>
        ) : null}
        {!isMe ? <span>{roleName}</span> : null}
        <span className='msg-time'>{fmtTime(m.sendTime)}</span>
        {isMe ? (
          <span className={cx('avatar', avClass)}>{avLabel}</span>
        ) : null}
      </div>
      <div className='msg-bubble'>
        {renderContent(m.content, m.contentType, m)}
      </div>
    </motion.div>
  );
});

export const IMMessageList = memo(function IMMessageList({
  messages,
  humanAgentId,
  agentRoleById,
  fmtTime,
  renderContent,
  cx,
}: IMMessageListProps) {
  // Track which messages were already present on the previous render
  // so we only animate truly new messages (not all messages on mount)
  const prevIdsRef = useRef<Set<string>>(new Set());

  const currentIds = new Set(messages.map((m) => m.id));
  const newIds = new Set<string>();
  for (const id of currentIds) {
    if (!prevIdsRef.current.has(id)) {
      newIds.add(id);
    }
  }
  // Update ref after computing new ids (use microtask to avoid mutating during render)
  Promise.resolve().then(() => {
    prevIdsRef.current = currentIds;
  });

  return (
    <Virtuoso
      data={messages}
      style={{ height: "100%" }}
      followOutput="smooth"
      initialTopMostItemIndex={Math.max(0, messages.length - 1)}
      increaseViewportBy={{ top: 600, bottom: 600 }}
      itemContent={(index, m) => (
        <MessageItem
          m={m}
          humanAgentId={humanAgentId}
          agentRoleById={agentRoleById}
          fmtTime={fmtTime}
          renderContent={renderContent}
          cx={cx}
          isNew={newIds.has(m.id)}
        />
      )}
    />
  );
});
