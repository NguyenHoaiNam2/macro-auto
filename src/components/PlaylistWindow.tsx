import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, X } from 'lucide-react';
import { PlaylistItem } from './FloatingMiniMenu';

interface PlaylistWindowProps {
  isOpen: boolean;
  playlist: PlaylistItem[];
  onClose: () => void;
  onSelect: (item: PlaylistItem) => void;
  onRemove: (id: string) => void;
}

export const PlaylistWindow: React.FC<PlaylistWindowProps> = ({
  isOpen,
  playlist,
  onClose,
  onSelect,
  onRemove,
}) => {
  const [popup, setPopup] = useState<Window | null>(null);
  const [root, setRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const playlistWindow = window.open(
      '',
      'smart-macro-playlist',
      'popup=yes,width=520,height=360,resizable=yes'
    );

    if (!playlistWindow) {
      onClose();
      return;
    }

    playlistWindow.document.title = 'Smart Macro Playlist';
    playlistWindow.document.body.innerHTML = '';
    playlistWindow.document.body.style.margin = '0';
    playlistWindow.document.body.style.background = '#0a0a0a';

    document.querySelectorAll('link[rel="stylesheet"], style').forEach((style) => {
      playlistWindow.document.head.appendChild(style.cloneNode(true));
    });

    const playlistRoot = playlistWindow.document.createElement('div');
    playlistRoot.id = 'playlist-root';
    playlistWindow.document.body.appendChild(playlistRoot);
    playlistWindow.focus();
    setPopup(playlistWindow);
    setRoot(playlistRoot);

    const monitor = window.setInterval(() => {
      if (playlistWindow.closed) {
        window.clearInterval(monitor);
        setPopup(null);
        setRoot(null);
        onClose();
      }
    }, 250);

    return () => {
      window.clearInterval(monitor);
      if (!playlistWindow.closed) playlistWindow.close();
      setPopup(null);
      setRoot(null);
    };
  }, [isOpen, onClose]);

  if (!popup || !root || popup.closed) return null;

  return createPortal(
    <main className="flex h-screen w-screen flex-col overflow-hidden bg-neutral-950 p-4 font-sans text-neutral-100">
      <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-neutral-800 bg-neutral-950 p-4 shadow-2xl">
        <header className="flex items-center justify-between border-b border-neutral-800 pb-3">
          <div>
            <h1 className="text-sm font-semibold text-white">Playlist</h1>
            <p className="text-[11px] text-neutral-500">Loaded macro files</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close playlist"
            className="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto py-3">
          {playlist.length === 0 ? (
            <div className="flex min-h-[240px] items-center justify-center text-center text-xs text-neutral-500">
              Load a .json macro from the HUD to add it here.
            </div>
          ) : (
            playlist.map((item) => (
              <div key={item.id} className="flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900/80 p-2.5">
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="block truncate text-xs font-medium text-neutral-200">{item.name}</span>
                  <span className="text-[11px] text-neutral-500">{item.steps.length} steps</span>
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(item.id)}
                  aria-label={`Remove ${item.name}`}
                  className="rounded-md p-1.5 text-neutral-500 hover:bg-red-950/50 hover:text-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </main>,
    root
  );
};
