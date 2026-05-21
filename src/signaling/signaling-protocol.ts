export type SignalMessageType = 
  | "peer_join" 
  | "peer_leave" 
  | "signal_offer" 
  | "signal_answer" 
  | "ice_candidate"
  | "register";

export interface SignalMessage {
  type: SignalMessageType;
  from: string;
  target?: string;
  payload?: any;
}
