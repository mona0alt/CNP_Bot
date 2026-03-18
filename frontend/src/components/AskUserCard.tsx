import { Bot, Send } from 'lucide-react';
import { useState } from 'react';

import type { AskUserRequest } from '@/lib/interactive-events';

interface AskUserCardProps {
  request: AskUserRequest;
  onSubmit: (requestId: string, answer: string) => void;
}

export function AskUserCard({ request, onSubmit }: AskUserCardProps) {
  const [answer, setAnswer] = useState('');
  const isPending = !request.answered;

  return (
    <div className="flex items-start gap-3 my-4">
      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <Bot className="w-5 h-5 text-primary" />
      </div>
      <div className="flex-1 max-w-[80%]">
        <div className="bg-muted rounded-2xl px-4 py-3 rounded-bl-sm">
          <p className="text-sm">{request.question}</p>
        </div>
        {isPending ? (
          <form
            className="mt-2 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!answer.trim()) return;
              onSubmit(request.requestId, answer.trim());
            }}
          >
            <input
              type="text"
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder="输入你的回答..."
              disabled={request.submitting}
              className="flex-1 px-3 py-2 text-sm bg-background border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              autoFocus
            />
            <button
              type="submit"
              disabled={!answer.trim() || request.submitting}
              className="p-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
          
        ) : (
          <div className="mt-2 p-2 bg-primary/5 rounded-lg border">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium">你的回答:</span> {request.answer}
            </p>
          </div>
        )}
        {request.submitting && (
          <div className="mt-2 text-xs text-muted-foreground">正在提交回答...</div>
        )}
      </div>
    </div>
  );
}
