import { memo } from "react";
import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
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
}: {
  m: Message;
  humanAgentId?: string | null;
  agentRoleById: Map<string, string>;
  fmtTime: (iso: string) => string;
  renderContent: (content: string, contentType: string, message?: Message) => ReactNode;
  cx: (...classes: Array<string | false | undefined | null>) => string;
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
      initial="hidden"
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
  return (
    <>
      {messages.map((m) => (
        <MessageItem
          key={m.id}
          m={m}
          humanAgentId={humanAgentId}
          agentRoleById={agentRoleById}
          fmtTime={fmtTime}
          renderContent={renderContent}
          cx={cx}
        />
      ))}
    </>
  );
});