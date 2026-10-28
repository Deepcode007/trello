import React, { createContext, useContext } from "react";
import { useAppSocket, type AppSocketContextValue, type UseAppSocketOptions } from "../hooks/useAppSocket";

export const SocketContext = createContext<AppSocketContextValue | null>(null);

export function useSocketContext(): AppSocketContextValue | null {
  return useContext(SocketContext);
}

export interface SocketProviderProps {
  children: React.ReactNode;
  value?: AppSocketContextValue | null;
  options?: UseAppSocketOptions;
}

export function SocketProvider({
  children,
  value,
  options
}: SocketProviderProps) {
  const defaultSocketState = useAppSocket(options);
  const contextValue = value !== undefined ? value : defaultSocketState;

  return (
    <SocketContext.Provider value={contextValue}>
      {children}
    </SocketContext.Provider>
  );
}
