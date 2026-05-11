import { createContext, useContext, useState, useEffect } from 'react';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

type Club = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  city: string | null;
  country: string | null;
};

type ClubContextValue = {
  club: Club | null;
  isLoading: boolean;
  error: string | null;
};

const ClubContext = createContext<ClubContextValue | null>(null);

export function ClubProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ club: Club | null; isLoading: boolean; error: string | null }>({
    club: null,
    isLoading: true,
    error: null
  });

  useEffect(() => {
    fetch(`${apiBaseUrl}/clubs`)
      .then(res => res.json())
      .then((data: { clubs: Club[] }) => {
        setState({ club: data.clubs[0] || null, isLoading: false, error: null });
      })
      .catch(err => {
        setState({ club: null, isLoading: false, error: err.message });
      });
  }, []);

  return (
    <ClubContext.Provider value={state}>
      {children}
    </ClubContext.Provider>
  );
}

export function useClub() {
  const context = useContext(ClubContext);
  if (!context) throw new Error('useClub must be used within ClubProvider');
  return context;
}
