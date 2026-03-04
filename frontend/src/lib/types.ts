export interface Chat {
  jid: string;
  name: string;
  last_message_time: string;
  is_group: number;
}

export interface Message {
  id: string;
  chat_jid: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: boolean;
  is_bot_message: boolean;
}

export interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: any;
  partial_json?: string;
  status?: "calling" | "executed" | "error";
  result?: any;
}