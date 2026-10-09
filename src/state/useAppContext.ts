import { useContext } from 'react';
import { AppStateContext } from './AppStateContext';
export function useAppContext() { return useContext(AppStateContext); }
