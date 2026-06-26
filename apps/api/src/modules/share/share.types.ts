export type ShareTargetType = "point" | "place";

/** Raw row shape returned by share queries (internal id is never selected). */
export type ShareLinkRow = {
    code: string;
    target_type: ShareTargetType;
    place_public_id: string | null;
    lat: number | null;
    lng: number | null;
    zoom: number | null;
    address_line: string | null;
    plus_code: string | null;
};

export type CreateShareLinkResult = {
    code: string;
    url: string;
};

/** Public resolve payload — point exposes the cached snapshot, place exposes only its public uuid. */
export type ResolvedShareLink =
    | {
          target_type: "point";
          lat: number;
          lng: number;
          zoom: number | null;
          address_line: string | null;
          plus_code: string | null;
      }
    | {
          target_type: "place";
          place_public_id: string;
      };
