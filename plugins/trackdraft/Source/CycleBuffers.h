#pragma once

#include "Song.h"

#include <array>
#include <atomic>

namespace td
{
/**
    A small pool of flattened cycles, so the audio thread can read one while the
    message thread builds the next — without either side taking a lock.

    The song is edited on the message thread and `SongCycle::rebuild` writes into
    its entry list; the callback only reads. The alternative, a lock held across
    `processBlock`, is a lock in the worst place: it is held for the whole of note
    scheduling, so an editor edit can stall the callback and a slow callback can
    stall the editor.

    Instead a buffer has exactly one owner at a time, and ownership moves through
    two atomic pointers:

        message: take() -> build -> publish()   (offers the buffer as `pending`)
        audio:   read()                          (takes `pending`, retires what it
                                                  was reading as `retired`)

    A buffer the message thread can `take()` is never the one being read: it is
    either untouched or was handed back through `retired`, and the callback
    retires a buffer before it starts reading the next one. Every `publish()` and
    `take()` also reclaims whatever the callback retired, so with four buffers and
    at most one current, one pending and one retired, one is always free — neither
    thread ever waits for the other, and no reader can see a half-rebuilt cycle.

    A published cycle is always finished before it is offered, so an edit during
    playback cannot drop notes either: the callback plays either the old cycle or
    the new one, never an empty list.
*/
class CycleBuffers
{
public:
    static constexpr int bufferCount = 4;

    static_assert (bufferCount > 3,
                   "one current, one pending and one retired are all off the free list");

    CycleBuffers()
    {
        for (int index = 1; index < bufferCount; ++index)
            free[(std::size_t) freeCount++] = &buffers[(std::size_t) index];

        current = &buffers[0];
    }

    /** Message thread: a buffer nothing else owns, to rebuild.

        Null only if the pool is empty, which the static_assert above rules out.
        An edit that cannot be given a buffer is dropped rather than written into
        one the callback is reading. */
    SongCycle* take() noexcept
    {
        reclaim();

        jassert (freeCount > 0);
        if (freeCount == 0)
            return nullptr;

        return free[(std::size_t) --freeCount];
    }

    /** Message thread: offer a rebuilt buffer to the audio thread. A buffer the
        callback has not picked up yet is still ours, so it comes back. */
    void publish (SongCycle& cycle) noexcept
    {
        if (auto* unconsumed = pending.exchange (&cycle, std::memory_order_acq_rel))
            free[(std::size_t) freeCount++] = unconsumed;

        reclaim();
    }

    /** Message thread: rebuild and publish, for the constructor and for tests. */
    void rebuildFrom (const Song& song)
    {
        if (auto* next = take())
        {
            next->rebuild (song);
            publish (*next);
        }
    }

    /** Audio thread: the cycle to play this block. No lock, no allocation. */
    const SongCycle& read() noexcept
    {
        if (auto* next = pending.exchange (nullptr, std::memory_order_acquire))
        {
            retired.store (current, std::memory_order_release);
            current = next;
        }

        return *current;
    }

private:
    void reclaim() noexcept
    {
        while (auto* old = retired.exchange (nullptr, std::memory_order_acquire))
            free[(std::size_t) freeCount++] = old;
    }

    std::array<SongCycle, bufferCount> buffers;
    /** Message thread only. */
    std::array<SongCycle*, bufferCount> free {};
    int freeCount = 0;
    /** Audio thread only. */
    SongCycle* current = nullptr;
    std::atomic<SongCycle*> pending { nullptr };
    std::atomic<SongCycle*> retired { nullptr };
};
} // namespace td
