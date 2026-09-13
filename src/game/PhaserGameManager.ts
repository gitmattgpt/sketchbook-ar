import Phaser from 'phaser';
import type { CollisionGrid } from '@/types';

const GAME_WIDTH = 128;
const GAME_HEIGHT = 128;
const SCALE_UP = 3;
const GRAVITY = 0.12;
const MOVE_SPEED = 0.5;
const JUMP_FORCE = -2.2;
const MAX_FALL = 3.5;

function isSolid(grid: CollisionGrid | null, x: number, y: number): boolean {
  if (!grid) return false;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || ix >= grid.width || iy < 0 || iy >= grid.height) return false;
  return grid.data[iy * grid.width + ix] === 1;
}

function generateStickmanTexture(scene: Phaser.Scene, key: string, frame: number): void {
  const graphics = scene.make.graphics({ x: 0, y: 0 }, false);
  graphics.lineStyle(2.5, 0x2b2b2b, 1);
  graphics.fillStyle(0xf7f3e8, 1);

  graphics.fillCircle(12, 6, 4);
  graphics.strokeCircle(12, 6, 4);

  graphics.beginPath();
  graphics.moveTo(12, 10);
  graphics.lineTo(12, 20);
  graphics.strokePath();

  const armSwing = frame === 0 ? 0 : frame === 1 ? 5 : -5;
  const legSwing = frame === 0 ? 0 : frame === 1 ? 6 : -6;

  graphics.beginPath();
  graphics.moveTo(12, 13);
  graphics.lineTo(12 - armSwing, 19);
  graphics.strokePath();

  graphics.beginPath();
  graphics.moveTo(12, 13);
  graphics.lineTo(12 + armSwing, 19);
  graphics.strokePath();

  graphics.beginPath();
  graphics.moveTo(12, 20);
  graphics.lineTo(12 - legSwing, 26);
  graphics.strokePath();

  graphics.beginPath();
  graphics.moveTo(12, 20);
  graphics.lineTo(12 + legSwing, 26);
  graphics.strokePath();

  graphics.generateTexture(key, 24, 28);
  graphics.destroy();
}

export class GameScene extends Phaser.Scene {
  private stickman: Phaser.GameObjects.Container | null = null;
  private stickmanSprite: Phaser.GameObjects.Image | null = null;
  private gridOverlay: Phaser.GameObjects.Image | null = null;
  private gridTexture: Phaser.Textures.CanvasTexture | null = null;
  private collisionGrid: CollisionGrid | null = null;
  private vx = 0;
  private vy = 0;
  private grounded = false;
  private inputLeft = false;
  private inputRight = false;
  private inputJump = false;
  private onPosUpdate: ((pos: { x: number; y: number }) => void) | null = null;
  private walkAnim: Phaser.Time.TimerEvent | null = null;
  private currentFrame = 0;

  constructor() {
    super({ key: 'GameScene' });
  }

  create() {
    generateStickmanTexture(this, 'stickman-idle', 0);
    generateStickmanTexture(this, 'stickman-walk1', 1);
    generateStickmanTexture(this, 'stickman-walk2', 2);

    this.cameras.main.setBackgroundColor('#f7f3e8');

    this.gridTexture = this.textures.createCanvas('gridOverlay', GAME_WIDTH, GAME_HEIGHT);
    if (this.gridTexture) {
      this.gridOverlay = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'gridOverlay');
      this.gridOverlay.setAlpha(0.5);
    }

    this.stickmanSprite = this.add.image(0, 0, 'stickman-idle');
    this.stickman = this.add.container(64, 20, [this.stickmanSprite]);
    this.stickman.setDepth(10);

    const leftZone = this.add.zone(0, 0, GAME_WIDTH / 3, GAME_HEIGHT).setOrigin(0, 0);
    leftZone.setInteractive();
    leftZone.on('pointerdown', () => { this.inputLeft = true; });
    leftZone.on('pointerup', () => { this.inputLeft = false; });
    leftZone.on('pointerout', () => { this.inputLeft = false; });

    const rightZone = this.add.zone(GAME_WIDTH * 2 / 3, 0, GAME_WIDTH / 3, GAME_HEIGHT).setOrigin(0, 0);
    rightZone.setInteractive();
    rightZone.on('pointerdown', () => { this.inputRight = true; });
    rightZone.on('pointerup', () => { this.inputRight = false; });
    rightZone.on('pointerout', () => { this.inputRight = false; });

    const centerZone = this.add.zone(GAME_WIDTH / 3, 0, GAME_WIDTH / 3, GAME_HEIGHT).setOrigin(0, 0);
    centerZone.setInteractive();
    centerZone.on('pointerdown', () => { this.inputJump = true; });

    this.input.keyboard?.on('keydown-LEFT', () => { this.inputLeft = true; });
    this.input.keyboard?.on('keyup-LEFT', () => { this.inputLeft = false; });
    this.input.keyboard?.on('keydown-RIGHT', () => { this.inputRight = true; });
    this.input.keyboard?.on('keyup-RIGHT', () => { this.inputRight = false; });
    this.input.keyboard?.on('keydown-UP', () => { this.inputJump = true; });
    this.input.keyboard?.on('keydown-SPACE', () => { this.inputJump = true; });
  }

  setCollisionGrid(grid: CollisionGrid, gridCanvas: HTMLCanvasElement) {
    this.collisionGrid = grid;

    if (this.gridTexture) {
      const ctx = this.gridTexture.getContext();
      ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
      ctx.drawImage(gridCanvas, 0, 0);
      this.gridTexture.refresh();
    }

    this.spawnStickman();
  }

  private spawnStickman() {
    if (!this.collisionGrid || !this.stickman) return;

    const cx = Math.floor(this.collisionGrid.width / 2);
    let spawnY = 10;

    for (let y = 0; y < this.collisionGrid.height; y++) {
      if (isSolid(this.collisionGrid, cx, y)) {
        spawnY = Math.max(0, y - 14);
        break;
      }
    }

    this.stickman.x = cx;
    this.stickman.y = spawnY;
    this.vx = 0;
    this.vy = 0;
  }

  setOnPositionUpdate(cb: (pos: { x: number; y: number }) => void) {
    this.onPosUpdate = cb;
  }

  update() {
    if (!this.stickman || !this.collisionGrid) return;

    const charWidth = 8;
    const charHeight = 14;

    let targetVx = 0;
    if (this.inputLeft) targetVx = -MOVE_SPEED;
    if (this.inputRight) targetVx = MOVE_SPEED;
    this.vx = targetVx;

    if (this.inputJump && this.grounded) {
      this.vy = JUMP_FORCE;
      this.grounded = false;
      this.inputJump = false;
    } else {
      this.inputJump = false;
    }

    this.vy += GRAVITY;
    if (this.vy > MAX_FALL) this.vy = MAX_FALL;

    const newX = this.stickman.x + this.vx;
    if (!this.checkCollision(newX, this.stickman.y, charWidth, charHeight)) {
      this.stickman.x = newX;
    } else {
      this.vx = 0;
    }

    const newY = this.stickman.y + this.vy;
    if (!this.checkCollision(this.stickman.x, newY, charWidth, charHeight)) {
      this.stickman.y = newY;
      this.grounded = false;
    } else {
      if (this.vy > 0) {
        this.grounded = true;
      }
      this.vy = 0;
    }

    this.stickman.x = Phaser.Math.Clamp(this.stickman.x, 4, GAME_WIDTH - 4);
    this.stickman.y = Phaser.Math.Clamp(this.stickman.y, 4, GAME_HEIGHT - 4);

    if (this.grounded && (this.inputLeft || this.inputRight)) {
      if (!this.walkAnim) {
        this.currentFrame = this.currentFrame === 0 ? 1 : (this.currentFrame === 1 ? 2 : 1);
        this.stickmanSprite?.setTexture(this.currentFrame === 1 ? 'stickman-walk1' : 'stickman-walk2');
        this.walkAnim = this.time.delayedCall(120, () => { this.walkAnim = null; });
      }
    } else {
      this.stickmanSprite?.setTexture('stickman-idle');
    }

    if (this.inputLeft && !this.inputRight) {
      this.stickmanSprite?.setFlipX(true);
    } else if (this.inputRight && !this.inputLeft) {
      this.stickmanSprite?.setFlipX(false);
    }

    if (this.onPosUpdate) {
      this.onPosUpdate({ x: this.stickman.x, y: this.stickman.y });
    }
  }

  private checkCollision(x: number, y: number, w: number, h: number): boolean {
    if (!this.collisionGrid) return false;

    const left = x - w / 2;
    const right = x + w / 2;
    const top = y - h / 2;
    const bottom = y + h / 2;

    const checkPoints = [
      [left, bottom], [right, bottom], [x, bottom],
      [left, top], [right, top],
      [left, y], [right, y],
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
        width: GAME_WIDTH * SCALE_UP,
        height: GAME_HEIGHT * SCALE_UP,
        backgroundColor: '#f7f3e8',
        scale: {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
        scene: [this.scene],
        render: {
          pixelArt: true,
          antialias: false,
        },
        fps: {
          target: 60,
          min: 30,
        },
      });

      this.game.events.once(Phaser.Core.Events.READY, () => resolve());
    });
  }

  setCollisionGrid(grid: CollisionGrid, gridCanvas: HTMLCanvasElement) {
    this.scene?.setCollisionGrid(grid, gridCanvas);
  }

  setOnPositionUpdate(cb: (pos: { x: number; y: number }) => void) {
    this.scene?.setOnPositionUpdate(cb);
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
    }
  }
}
