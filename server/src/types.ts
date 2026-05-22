export type Suit = 'man' | 'pin' | 'sou' | 'honor';

export interface Tile {
  id: string;
  suit: Suit;
  value: number; // 1-9 for man/pin/sou, 1-7 for honor (1-4=winds E/S/W/N, 5=白 6=発 7=中)
}

export interface Meld {
  type: 'chi' | 'pon' | 'minkan' | 'ankan';
  tiles: Tile[];
  fromSeat?: number;
}

export type GamePhase =
  | 'dealing'
  | 'draw'
  | 'discard'
  | 'claiming'
  | 'roundEnd'
  | 'gameOver';

export type Wind = 'east' | 'south' | 'west' | 'north';

export const WINDS: Wind[] = ['east', 'south', 'west', 'north'];

export interface ClaimRequest {
  type: 'chi' | 'pon' | 'ron' | 'skip';
  chiTiles?: [string, string];
}

export interface PlayerView {
  seat: number;
  name: string;
  handCount: number;
  discards: Tile[];
  melds: Meld[];
  score: number;
  isDealer: boolean;
  seatWind: Wind;
}

export interface GameView {
  phase: GamePhase;
  round: Wind;
  roundNumber: number;
  honbaCount: number;
  dealer: number;
  currentTurn: number;
  wallCount: number;
  doraIndicators: Tile[];
  lastDiscard?: { tile: Tile; seat: number };
  players: PlayerView[];
  myHand: Tile[];
  mySeat: number;
  availableClaims?: Array<'chi' | 'pon' | 'ron'>;
  chiCombinations?: [string, string][];
}

export interface RoundResult {
  isDraw: boolean;
  winner?: number;
  losers?: number[];
  winTile?: Tile;
  winType?: 'tsumo' | 'ron';
  handTiles?: Tile[];
  melds?: Meld[];
  scoreDelta: Record<number, number>;
  newScores: Record<number, number>;
}

export interface RoomInfo {
  id: string;
  name: string;
  maxPlayers: 3 | 4;
  currentPlayers: number;
  status: 'waiting' | 'playing';
}

export interface ServerToClientEvents {
  rooms: (rooms: RoomInfo[]) => void;
  'room-joined': (data: { roomId: string; seat: number; playerName: string }) => void;
  'room-update': (data: {
    players: { name: string; seat: number }[];
    maxPlayers: number;
    roomName: string;
  }) => void;
  'game-start': (view: GameView) => void;
  'game-update': (view: GameView) => void;
  'round-end': (result: RoundResult) => void;
  error: (message: string) => void;
}

export interface ClientToServerEvents {
  'get-rooms': (callback: (rooms: RoomInfo[]) => void) => void;
  'create-room': (
    data: { name: string; maxPlayers: 3 | 4; playerName: string },
    callback: (result: { success: boolean; roomId?: string; error?: string }) => void
  ) => void;
  'join-room': (
    data: { roomId: string; playerName: string },
    callback: (result: { success: boolean; seat?: number; error?: string }) => void
  ) => void;
  'start-game': () => void;
  'discard-tile': (tileId: string) => void;
  claim: (claim: ClaimRequest) => void;
  'declare-tsumo': () => void;
  'ready-next': () => void;
}
