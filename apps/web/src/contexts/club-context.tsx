import { createContext, useContext, useState, useEffect } from 'react';
import { apiBaseUrl } from '../lib/http.js';
import { useAuth } from './auth-context.js';

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
  clubs: Club[];
  isLoading: boolean;
  error: string | null;
  selectedClubId: string | null;
  createClubDialogOpen: boolean;
  setSelectedClubId: (clubId: string) => void;
  setCreateClubDialogOpen: (open: boolean) => void;
};

const ClubContext = createContext<ClubContextValue | null>(null);

export function ClubProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoading: isAuthLoading } = useAuth();
  const [clubs, setClubs] = useState<Club[]>([]);
  const [selectedClubId, setSelectedClubId] = useState<string | null>(null);
  const [createClubDialogOpen, setCreateClubDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const club = clubs.find(c => c.id === selectedClubId) || null;

  useEffect(() => {
    if (isAuthLoading) {
      setIsLoading(true);
      return;
    }

    if (!user) {
      setClubs([]);
      setSelectedClubId(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();

    // Load saved club ID from localStorage
    const savedClubId = localStorage.getItem('selectedClubId');

    fetch(`${apiBaseUrl}/clubs`, {
      credentials: 'include',
      signal: controller.signal
    })
      .then(async res => {
        if (!res.ok) {
          throw new Error(`Failed to load clubs (${res.status})`);
        }
        return res.json();
      })
      .then((data: { clubs: Club[] }) => {
        setClubs(data.clubs);

        // Select saved club if it exists in the list, otherwise select first club
        if (savedClubId && data.clubs.find(c => c.id === savedClubId)) {
          setSelectedClubId(savedClubId);
        } else if (data.clubs.length > 0 && data.clubs[0]) {
          setSelectedClubId(data.clubs[0].id);
        }

        setIsLoading(false);
        setError(null);
      })
      .catch(err => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        setError(err.message);
        setIsLoading(false);
      });

    return () => controller.abort();
  }, [isAuthLoading, user]);

  const handleSetSelectedClubId = (clubId: string) => {
    setSelectedClubId(clubId);
    localStorage.setItem('selectedClubId', clubId);
  };

  const handleSetCreateClubDialogOpen = (open: boolean) => {
    setCreateClubDialogOpen(open);
  };

  const value: ClubContextValue = {
    club,
    clubs,
    isLoading,
    error,
    selectedClubId,
    createClubDialogOpen,
    setSelectedClubId: handleSetSelectedClubId,
    setCreateClubDialogOpen: handleSetCreateClubDialogOpen
  };

  return (
    <ClubContext.Provider value={value}>
      {children}
    </ClubContext.Provider>
  );
}

export function useClub() {
  const context = useContext(ClubContext);
  if (!context) throw new Error('useClub must be used within ClubProvider');
  return context;
}
