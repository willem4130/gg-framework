import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import {
  deleteMemory,
  isMemoryChangeEvent,
  listMemories,
  subscribe,
  type Memory,
  type MemorySnapshot,
} from "./agent";
import { Modal } from "./Modal";

interface Props {
  onClose: () => void;
}

const EMPTY_SNAPSHOT: MemorySnapshot = { memories: [], softLimit: 60, hardLimit: 90 };

function updatedLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

export function MemoryModal({ onClose }: Props): React.ReactElement {
  const [snapshot, setSnapshot] = useState<MemorySnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const next = await listMemories();
      setSnapshot(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return subscribe((event) => {
      if (isMemoryChangeEvent(event)) void refresh();
    });
  }, [refresh]);

  const remove = useCallback(async (memory: Memory): Promise<void> => {
    setDeletingId(memory.id);
    try {
      setSnapshot(await deleteMemory(memory.id));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeletingId(null);
    }
  }, []);

  return (
    <Modal
      title={
        <span>
          Memories{" "}
          <span className="memory-modal-count">
            {snapshot.memories.length} / {snapshot.hardLimit}
          </span>
        </span>
      }
      onClose={onClose}
      className="memory-modal"
    >
      <div className="memory-modal-note">
        Related memories are consolidated once the list reaches {snapshot.softLimit}.
      </div>
      <div className="memory-table-wrap">
        {loading ? (
          <div className="memory-modal-state">Loading memories…</div>
        ) : error ? (
          <div className="memory-modal-state memory-modal-error" role="alert">
            Couldn’t load memories: {error}
          </div>
        ) : snapshot.memories.length === 0 ? (
          <div className="memory-modal-state">No durable memories yet.</div>
        ) : (
          <table className="memory-table">
            <thead>
              <tr>
                <th>Memory</th>
                <th>Category</th>
                <th>Importance</th>
                <th>Updated</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {snapshot.memories.map((memory) => (
                <tr key={memory.id}>
                  <td className="memory-table-text">{memory.text}</td>
                  <td>
                    <span className="memory-category">{memory.category}</span>
                  </td>
                  <td
                    className="memory-importance"
                    aria-label={`Importance ${memory.importance} of 5`}
                  >
                    {memory.importance} / 5
                  </td>
                  <td className="memory-updated">{updatedLabel(memory.updatedAt)}</td>
                  <td className="memory-delete-cell">
                    <button
                      type="button"
                      className="memory-delete"
                      aria-label={`Delete memory: ${memory.text}`}
                      title="Delete memory"
                      disabled={deletingId === memory.id}
                      onClick={() => void remove(memory)}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}
