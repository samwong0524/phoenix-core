import { useState } from "react";

export function QuestionCard({
  questionId,
  question,
  options,
  answered,
  onAnswer,
}: {
  questionId: string;
  question: string;
  options: Array<{ label: string; description?: string }>;
  answered: boolean;
  onAnswer: (label: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(answered ? "__answered__" : null);

  const handleClick = (label: string) => {
    if (selected) return;
    setSelected(label);
    onAnswer(label);
  };

  return (
    <div className="question-card">
      <div className="question-card-text">{question}</div>
      <div className="question-card-options">
        {options.map((opt) => (
          <button
            key={opt.label}
            className={`question-option-btn${selected === opt.label ? " selected" : ""}`}
            disabled={!!selected}
            onClick={() => handleClick(opt.label)}
          >
            <span className="question-option-label">{opt.label}</span>
            {opt.description ? <span className="question-option-desc">{opt.description}</span> : null}
          </button>
        ))}
      </div>
      {selected === "__answered__" && (
        <div className="question-card-answered">已回复</div>
      )}
    </div>
  );
}
