import { create } from 'zustand';

export type AppState = 'BOOTING' | 'HYDRATING' | 'READY' | 'ERROR';

interface SystemState {
    status: AppState;
    errorMessage?: string;

    setStatus: (status: AppState) => void;
    setError: (message: string) => void;
}

export const useSystemStore = create<SystemState>((set) => ({
    status: 'BOOTING', // Default state must be BOOTING
    errorMessage: undefined,

    setStatus: (status) => set({ status }),
    setError: (message) => set({ status: 'ERROR', errorMessage: message }),
}));
