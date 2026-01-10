import Dexie, { Table } from "dexie";
import type { TrackRecord } from "./schema";

class LyricsDatabase extends Dexie {
  tracks!: Table<TrackRecord, string>;

  constructor() {
    super("lyrics_cloud");
    this.version(1).stores({
      tracks: "id, title, album, year, *lyricists, artist",
    });
  }
}

export const db = new LyricsDatabase();
