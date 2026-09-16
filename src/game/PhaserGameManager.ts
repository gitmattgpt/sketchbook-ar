import Phaser from 'phaser';
import type { CollisionGrid } from '@/types';
import { GRID_WIDTH, GRID_HEIGHT } from '@/utils/imageProcessor';

const GAME_WIDTH = GRID_WIDTH;
const GAME_HEIGHT = GRID_HEIGHT;

const BASE_GRAVITY = 0.14;
const BASE_MOVE_SPEED = 0.7;
const BASE_RUN_SPEED = 1.25;
const BASE_JUMP_FORCE = -2.8;
const BASE_MAX_FALL = 4;

const BASE_SPRITE_W = 9;
const BASE_SPRITE_H = 11;
const BASE_CHAR_W = 5;
const BASE_CHAR_H = 8;

function isSolid(grid: CollisionGrid | null, x: number, y: number): boolean {
  if (!grid) return false;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || ix >= grid.width || iy < 0 || iy >= grid.height) return false;
  return grid.data[iy * grid.width + ix] === 1;
}

function generateStickmanTexture(scene: Phaser.Scene, key: string, frame: number): void {
  const graphics = scene.make.graphics({ x: 0, y: 0 }, false);
  graphics.lineStyle(2, 0x2b2b2b, 1);
  graphics.strokeCircle(12, 6, 4);
  graphics.beginPath(); graphics.moveTo(12, 10); graphics.lineTo(12, 20); graphics.strokePath();
  const armSwing = frame === 0 ? 0 : frame === 1 ? 5 : -5;
  const legSwing = frame === 0 ? 0 : frame === 1 ? 6 : -6;
  graphics.beginPath(); graphics.moveTo(12, 13); graphics.lineTo(12 - armSwing, 19); graphics.strokePath();
  graphics.beginPath(); graphics.moveTo(12, 13); graphics.lineTo(12 + armSwing, 19); graphics.strokePath();
  graphics.beginPath(); graphics.moveTo(12, 20); graphics.lineTo(12 - legSwing, 26); graphics.strokePath();
  graphics.beginPath(); graphics.moveTo(12, 20); graphics.lineTo(12 + legSwing, 26); graphics.strokePath();
  graphics.generateTexture(key, 24, 28);
  graphics.destroy();
}

function generateFlagTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists('goal-flag')) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  // pole
  g.lineStyle(2, 0x2b2b2b, 1);
  g.beginPath(); g.moveTo(6, 4); g.lineTo(6, 26); g.strokePath();
  // flag triangle
  g.fillStyle(0xf1c40f, 1);
  g.beginPath();
  g.moveTo(6, 4);
  g.lineTo(20, 10);
  g.lineTo(6, 16);
  g.closePath();
  g.fillPath();
  g.lineStyle(1.5, 0x2b2b2b, 1);
  g.strokePath();
  g.generateTexture('goal-flag', 24, 28);
  g.destroy();
}

function inkOnlyDataUrl(src: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      const id = ctx.getImageData(0, 0, c.width, c.height);
      const d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        const brightness = (d[i] + d[i + 1] + d[i + 2]) / 3;
        if (brightness > 200 || d[i + 3] < 15) {
          d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 0;
        } else {
          d[i] = 43; d[i + 1] = 43; d[i + 2] = 43; d[i + 3] = 255;
        }
      }
      ctx.putImageData(id, 0, 0);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
}

export class GameScene extends Phaser.Scene {
  private stickman: Phaser.GameObjects.Container | null = null;
  private stickmanSprite: Phaser.GameObjects.Image | null = null;
  private flagSprite: Phaser.GameObjects.Image | null = null;
  private gridOverlay: Phaser.GameObjects.Image | null = null;
  private gridTexture: Phaser.Textures.CanvasTexture | null = null;
  private collisionGrid: CollisionGrid | null = null;
  private vx = 0;
  private vy = 0;
  private grounded = false;
  private inputLeft = false;
  private inputRight = false;
  private inputJump = false;
  private inputRun = false;
  private onPosUpdate: ((pos: { x: number; y: number }) => void) | null = null;
  private walkAnim: Phaser.Time.TimerEvent | null = null;
  private currentFrame = 0;
  private hasSpawned = false;
  private customWalkKeys: string[] = [];
  private useCustomWalk = false;
  private playerScale = 1;
  private worldScale = 1;
  private paused = false;
  private spawnPoint: { x: number; y: number } | null = null;
  private goalPoint: { x: number; y: number } | null = null;
  private goalCooldown = false;

  constructor() {
    super({ key: 'GameScene' });
  }

  create() {
    generateStickmanTexture(this, 'stickman-idle', 0);
    generateStickmanTexture(this, 'stickman-walk1', 1);
    generateStickmanTexture(this, 'stickman-walk2', 2);
    generateFlagTexture(this);

    this.cameras.main.setBackgroundColor('rgba(247, 243, 232, 0.94)');

    this.gridTexture = this.textures.createCanvas('gridOverlay', GAME_WIDTH, GAME_HEIGHT);
    if (this.gridTexture) {
      this.gridOverlay = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'gridOverlay');
      this.gridOverlay.setAlpha(0.9);
      this.gridOverlay.setDisplaySize(GAME_WIDTH, GAME_HEIGHT);
    }

    this.flagSprite = this.add.image(0, 0, 'goal-flag');
    this.flagSprite.setVisible(false);
    this.flagSprite.setDepth(9);
    this.applyFlagSize();

    this.stickmanSprite = this.add.image(0, 0, 'stickman-idle');
    this.applySpriteSize();
    this.stickman = this.add.container(GAME_WIDTH / 2, 24, [this.stickmanSprite]);
    this.stickman.setDepth(10);

    this.input.keyboard?.on('keydown-LEFT', () => { this.inputLeft = true; });
    this.input.keyboard?.on('keyup-LEFT', () => { this.inputLeft = false; });
    this.input.keyboard?.on('keydown-RIGHT', () => { this.inputRight = true; });
    this.input.keyboard?.on('keyup-RIGHT', () => { this.inputRight = false; });
    this.input.keyboard?.on('keydown-UP', () => { this.inputJump = true; });
    this.input.keyboard?.on('keydown-SPACE', () => { this.inputJump = true; });
    this.input.keyboard?.on('keydown-SHIFT', () => { this.inputRun = true; });
    this.input.keyboard?.on('keyup-SHIFT', () => { this.inputRun = false; });

    this.cameras.main.setBounds(0, 0, GAME_WIDTH, GAME_HEIGHT);
    this.cameras.main.centerOn(GAME_WIDTH / 2, GAME_HEIGHT / 2);

    this.loadCustomWalkFromStorage();
  }

  private applySpriteSize() {
    const w = BASE_SPRITE_W * this.playerScale;
    const h = BASE_SPRITE_H * this.playerScale;
    this.stickmanSprite?.setDisplaySize(w, h);
  }

  private applyFlagSize() {
    const w = BASE_SPRITE_W * this.playerScale;
    const h = BASE_SPRITE_H * this.playerScale;
    this.flagSprite?.setDisplaySize(w, h);
  }

  private getCharW() { return BASE_CHAR_W * this.playerScale; }
  private getCharH() { return BASE_CHAR_H * this.playerScale; }

  setPlayerScale(scale: number) {
    this.playerScale = Math.max(0.5, Math.min(3, scale));
    this.applySpriteSize();
    this.applyFlagSize();
  }

  setWorldScale(scale: number) {
    this.worldScale = Math.max(0.4, Math.min(2.5, scale));
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    if (paused) {
      this.inputLeft = false;
      this.inputRight = false;
      this.inputJump = false;
      this.inputRun = false;
      this.vx = 0;
      this.vy = 0;
    }
  }

  setExternalInput(left: boolean, right: boolean, jump: boolean, run: boolean) {
    if (this.paused) return;
    this.inputLeft = left;
    this.inputRight = right;
    if (jump) this.inputJump = true;
    this.inputRun = run;
  }

  setLevelPoints(spawn: { x: number; y: number } | null, goal: { x: number; y: number } | null) {
    this.spawnPoint = spawn;
    this.goalPoint = goal;
    this.goalCooldown = false;
    if (this.flagSprite) {
      if (goal) {
        this.flagSprite.setPosition(goal.x, goal.y);
        this.flagSprite.setVisible(true);
        this.applyFlagSize();
      } else {
        this.flagSprite.setVisible(false);
      }
    }
  }

  private async loadCustomWalkFromStorage() {
    try {
      const raw = localStorage.getItem('sketchbook-ar-active-walk');
      if (!raw) return;
      const urls: string[] = JSON.parse(raw);
      if (!Array.isArray(urls) || urls.length === 0) return;

      this.customWalkKeys = [];
      for (let i = 0; i < urls.length; i++) {
        const key = `custom-walk-${i}`;
        if (this.textures.exists(key)) this.textures.remove(key);
        const transparent = await inkOnlyDataUrl(urls[i]);
        this.textures.addBase64(key, transparent);
        this.customWalkKeys.push(key);
      }
      this.useCustomWalk = this.customWalkKeys.length > 0;

      if (this.stickmanSprite && this.useCustomWalk && this.customWalkKeys[0]) {
        this.time.delayedCall(50, () => {
          if (this.textures.exists(this.customWalkKeys[0])) {
            this.stickmanSprite?.setTexture(this.customWalkKeys[0]);
            this.applySpriteSize();
          }
        });
      }
    } catch {
      this.useCustomWalk = false;
    }
  }

  reloadCustomWalk() {
    this.loadCustomWalkFromStorage();
  }

  setCollisionGrid(grid: CollisionGrid, gridCanvas: HTMLCanvasElement, forceRespawn = false) {
    this.collisionGrid = grid;
    if (this.gridTexture && (this.gridTexture.width !== grid.width || this.gridTexture.height !== grid.height)) {
      this.textures.remove('gridOverlay');
      this.gridTexture = this.textures.createCanvas('gridOverlay', grid.width, grid.height);
      if (this.gridOverlay) {
        this.gridOverlay.destroy();
        this.gridOverlay = this.add.image(grid.width / 2, grid.height / 2, 'gridOverlay');
        this.gridOverlay.setDepth(0);
      }
    }
    if (this.gridTexture) {
      const ctx = this.gridTexture.getContext();
      ctx.clearRect(0, 0, grid.width, grid.height);
      ctx.drawImage(gridCanvas, 0, 0);
      this.gridTexture.refresh();
    }
    if (this.gridOverlay) {
      this.gridOverlay.setTexture('gridOverlay');
      this.gridOverlay.setPosition(grid.width / 2, grid.height / 2);
      this.gridOverlay.setDisplaySize(grid.width, grid.height);
      this.gridOverlay.setVisible(true);
      this.gridOverlay.setAlpha(0.92);
    }
    if (!this.hasSpawned || forceRespawn) {
      this.spawnStickman();
      this.hasSpawned = true;
    } else if (this.stickman) {
      this.stickman.x = Phaser.Math.Clamp(this.stickman.x, 4, grid.width - 4);
      this.stickman.y = Phaser.Math.Clamp(this.stickman.y, 4, grid.height - 4);
    }
  }

  private spawnStickman() {
    if (!this.collisionGrid || !this.stickman) return;
    let sx: number;
    let sy: number;
    if (this.spawnPoint) {
      sx = this.spawnPoint.x;
      sy = this.spawnPoint.y;
    } else {
      const cx = Math.floor(this.collisionGrid.width / 2);
      let spawnY = 20;
      for (let y = 0; y < this.collisionGrid.height; y++) {
        if (isSolid(this.collisionGrid, cx, y)) {
          spawnY = Math.max(4, y - 8);
          break;
        }
      }
      sx = cx;
      sy = spawnY;
    }
    this.stickman.x = sx;
    this.stickman.y = sy;
    this.vx = 0;
    this.vy = 0;
    this.grounded = false;
    this.goalCooldown = false;
  }

  restartSpawn() {
    this.spawnStickman();
  }

  setOnPositionUpdate(cb: (pos: { x: number; y: number }) => void) {
    this.onPosUpdate = cb;
  }

  private checkGoalOverlap() {
    if (!this.stickman || !this.goalPoint || this.goalCooldown) return;
    const charW = this.getCharW();
    const charH = this.getCharH();
    // Goal hitbox same size as player
    const gw = charW;
    const gh = charH;
    const dx = Math.abs(this.stickman.x - this.goalPoint.x);
    const dy = Math.abs(this.stickman.y - this.goalPoint.y);
    if (dx < (charW + gw) / 2 && dy < (charH + gh) / 2) {
      this.goalCooldown = true;
      this.spawnStickman();
    }
  }

  update() {
    if (!this.stickman || !this.collisionGrid || this.paused) return;

    const ws = this.worldScale;
    const moveSpeed = (this.inputRun ? BASE_RUN_SPEED : BASE_MOVE_SPEED) * ws;
    const gravity = BASE_GRAVITY * ws;
    const jumpForce = BASE_JUMP_FORCE * ws;
    const maxFall = BASE_MAX_FALL * ws;
    const charW = this.getCharW();
    const charH = this.getCharH();

    let targetVx = 0;
    if (this.inputLeft) targetVx = -moveSpeed;
    if (this.inputRight) targetVx = moveSpeed;
    this.vx = targetVx;

    if (this.inputJump && this.grounded) {
      this.vy = jumpForce;
      this.grounded = false;
      this.inputJump = false;
    } else {
      this.inputJump = false;
    }

    this.vy += gravity;
    if (this.vy > maxFall) this.vy = maxFall;

    const newX = this.stickman.x + this.vx;
    if (!this.checkCollision(newX, this.stickman.y, charW, charH)) {
      this.stickman.x = newX;
    } else {
      this.vx = 0;
    }

    const newY = this.stickman.y + this.vy;
    if (!this.checkCollision(this.stickman.x, newY, charW, charH)) {
      this.stickman.y = newY;
      this.grounded = false;
    } else {
      if (this.vy > 0) this.grounded = true;
      this.vy = 0;
    }

    this.stickman.x = Phaser.Math.Clamp(this.stickman.x, 4, this.collisionGrid.width - 4);
    this.stickman.y = Phaser.Math.Clamp(this.stickman.y, 4, this.collisionGrid.height - 4);

    this.checkGoalOverlap();

    if (this.grounded && (this.inputLeft || this.inputRight)) {
      if (!this.walkAnim) {
        if (this.useCustomWalk && this.customWalkKeys.length > 0) {
          this.currentFrame = (this.currentFrame + 1) % this.customWalkKeys.length;
          const key = this.customWalkKeys[this.currentFrame];
          if (this.textures.exists(key)) {
            this.stickmanSprite?.setTexture(key);
            this.applySpriteSize();
          }
        } else {
          this.currentFrame = this.currentFrame === 0 ? 1 : this.currentFrame === 1 ? 2 : 1;
          this.stickmanSprite?.setTexture(this.currentFrame === 1 ? 'stickman-walk1' : 'stickman-walk2');
          this.applySpriteSize();
        }
        const animMs = this.inputRun ? 80 : 120;
        this.walkAnim = this.time.delayedCall(animMs, () => { this.walkAnim = null; });
      }
    } else if (this.useCustomWalk && this.customWalkKeys[0] && this.textures.exists(this.customWalkKeys[0])) {
      this.stickmanSprite?.setTexture(this.customWalkKeys[0]);
      this.applySpriteSize();
    } else {
      this.stickmanSprite?.setTexture('stickman-idle');
      this.applySpriteSize();
    }

    if (this.inputLeft && !this.inputRight) this.stickmanSprite?.setFlipX(true);
    else if (this.inputRight && !this.inputLeft) this.stickmanSprite?.setFlipX(false);

    if (this.onPosUpdate) this.onPosUpdate({ x: this.stickman.x, y: this.stickman.y });
  }

  private checkCollision(x: number, y: number, w: number, h: number): boolean {
    if (!this.collisionGrid) return false;
    const left = x - w / 2;
    const right = x + w / 2;
    const top = y - h / 2;
    const bottom = y + h / 2;
    const checkPoints = [
      [left, bottom], [right, bottom], [x, bottom],
      [left, top], [right, top], [left, y], [right, y],
    ];
    for (const [px, py] of checkPoints) {
      if (isSolid(this.collisionGrid, px, py)) return true;
    }
    return false;
  }

  getCharacterPos(): { x: number; y: number } | null {
    if (!this.stickman) return null;
    return { x: this.stickman.x, y: this.stickman.y };
  }

  hasGrid(): boolean {
    return this.collisionGrid !== null;
  }

  resetSpawnFlag() {
    this.hasSpawned = false;
  }
}

export class PhaserGameManager {
  private game: Phaser.Game | null = null;
  private scene: GameScene | null = null;
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  init(): Promise<void> {
    return new Promise((resolve) => {
      this.scene = new GameScene();
      this.game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: this.container,
        width: GAME_WIDTH,
        height: GAME_HEIGHT,
        backgroundColor: '#f7f3e8',
        scale: {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_BOTH,
          width: GAME_WIDTH,
          height: GAME_HEIGHT,
        },
        scene: [this.scene],
        render: { pixelArt: true, antialias: false },
        fps: { target: 60, min: 30 },
        input: { activePointers: 3 },
      });
      this.game.events.once(Phaser.Core.Events.READY, () => {
        this.game?.scale.refresh();
        resolve();
      });
    });
  }

  setCollisionGrid(grid: CollisionGrid, gridCanvas: HTMLCanvasElement, forceRespawn = false) {
    this.scene?.setCollisionGrid(grid, gridCanvas, forceRespawn);
  }

  setOnPositionUpdate(cb: (pos: { x: number; y: number }) => void) {
    this.scene?.setOnPositionUpdate(cb);
  }

  setPlayerScale(scale: number) {
    this.scene?.setPlayerScale(scale);
  }

  setWorldScale(scale: number) {
    this.scene?.setWorldScale(scale);
  }

  setPaused(paused: boolean) {
    this.scene?.setPaused(paused);
  }

  setExternalInput(left: boolean, right: boolean, jump: boolean, run: boolean) {
    this.scene?.setExternalInput(left, right, jump, run);
  }

  setLevelPoints(spawn: { x: number; y: number } | null, goal: { x: number; y: number } | null) {
    this.scene?.setLevelPoints(spawn, goal);
  }

  reloadCustomWalk() {
    this.scene?.reloadCustomWalk();
  }

  restartSpawn() {
    this.scene?.restartSpawn();
  }

  getCharacterPos() {
    return this.scene?.getCharacterPos() ?? null;
  }

  hasGrid() {
    return this.scene?.hasGrid() ?? false;
  }

  destroy() {
    if (this.game) {
      this.game.destroy(true);
      this.game = null;
      this.scene = null;
    }
  }
}
