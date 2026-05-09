import Phaser from 'phaser';

type HomeSlot = {
  x: number;
  y: number;
};

type LearnObject = Phaser.GameObjects.Sprite & {
  correctTween: Phaser.Tweens.Tween;
  wrongTween: Phaser.Tweens.Tween;
  alphaTween: Phaser.Tweens.Tween;
  moveTween?: Phaser.Tweens.Tween;
  homeX: number;
  homeY: number;
  baseScaleX: number;
  baseScaleY: number;
  baseAngle: number;
  baseAlpha: number;
};

type LearnObjectConfig = Phaser.Types.GameObjects.Group.GroupCreateConfig & {
  translation?: string;
  sound?: Phaser.Sound.BaseSound;
};

type PromptProgress = {
  misses: number;
  wrongStreak: number;
};

export default class Demo extends Phaser.Scene {
  items: Phaser.GameObjects.Group;
  words: LearnObjectConfig[];
  nextWord: LearnObjectConfig;
  wordText: Phaser.GameObjects.Text;
  scoreText: Phaser.GameObjects.Text;
  muteText: Phaser.GameObjects.Text;
  feedbackText: Phaser.GameObjects.Text;
  feedbackTween?: Phaser.Tweens.Tween;

  // optional on-screen controls (useful on mobile)
  muteButton?: Phaser.GameObjects.Text;
  replayButton?: Phaser.GameObjects.Text;

  correctSound: Phaser.Sound.BaseSound;
  wrongSound: Phaser.Sound.BaseSound;

  private lastWordKey?: string;
  private promptProgress: Record<string, PromptProgress> = {};
  private awaitingNextQuestion = false;
  private inputLocked = false;
  private sfxMuted = false;
  private score = 0;
  private attempts = 0;
  private correctStreak = 0;
  private shufflePace = 0;

  private currentPromptSound?: Phaser.Sound.BaseSound;
  private itemSprites: LearnObject[] = [];
  private homeSlots: HomeSlot[] = [];
  private homeBaselineY = 0;

  constructor() {
    super('GameScene');
  }

  preload() {
    this.load.image('background', 'assets/images/background-city.png');
    this.load.image('building', 'assets/images/building.png');
    this.load.image('car', 'assets/images/car.png');
    this.load.image('house', 'assets/images/house.png');
    this.load.image('tree', 'assets/images/tree.png');

    this.load.audio('treeAudio', 'assets/audio/arbo.mp3');
    this.load.audio('carAudio', 'assets/audio/auto.mp3');
    this.load.audio('houseAudio', 'assets/audio/domo.mp3');
    this.load.audio('buildingAudio', 'assets/audio/konstruajo.mp3');
    this.load.audio('correct', 'assets/audio/correct.mp3');
    this.load.audio('wrong', 'assets/audio/wrong.mp3');
  }

  init() {
    this.words = [
      {
        key: 'building',
        setXY: {
          x: 100,
          y: 240
        },
        translation: 'konstruaĵo'
      },
      {
        key: 'house',
        setXY: {
          x: 240,
          y: 280
        },
        setScale: {
          x: 0.8,
          y: 0.8
        },
        translation: 'domo'
      },
      {
        key: 'car',
        setXY: {
          x: 400,
          y: 300
        },
        setScale: {
          x: 0.8,
          y: 0.8
        },
        translation: 'aŭto'
      },
      {
        key: 'tree',
        setXY: {
          x: 550,
          y: 250
        },
        translation: 'arbo'
      }
    ];

    this.promptProgress = this.words.reduce<Record<string, PromptProgress>>((progress, word) => {
      progress[word.key as string] = {
        misses: 0,
        wrongStreak: 0
      };

      return progress;
    }, {});
  }

  create() {
    this.items = this.add.group(this.words);

    // background
    this.add.sprite(0, 0, 'background').setOrigin(0, 0);

    // show group sprites on top of the background
    this.items.setDepth(1);

    this.itemSprites = this.items.getChildren() as LearnObject[];

    // Align all objects to a shared baseline (bottom edge), so when they shuffle between slots
    // they don't appear to float/sink due to differing sprite sizes.
    this.homeBaselineY = Math.max(
      ...this.itemSprites.map((item) => item.y + item.displayHeight * (1 - item.originY))
    );

    this.homeSlots = this.itemSprites.map((item) => ({
      x: item.x,
      y: this.homeBaselineY
    }));

    for (let i = 0; i < this.itemSprites.length; i++) {
      const item = this.itemSprites[i];

      // make item interactive
      item.setInteractive();

      // Cache baseline transform so we can always snap back after feedback tweens.
      item.homeX = item.x;
      item.homeY = this.homeBaselineY - item.displayHeight * (1 - item.originY);
      // Snap immediately so the initial layout uses the same baseline logic as shuffling.
      item.setY(item.homeY);
      item.baseScaleX = item.scaleX;
      item.baseScaleY = item.scaleY;
      item.baseAngle = item.angle;
      item.baseAlpha = item.alpha;

      // Correct answer feedback: keep the original main-branch feel (big pop + smooth yoyo).
      item.correctTween = this.tweens.add({
        targets: item,
        // Force a consistent start point so the tween never “shrinks first” depending on current scale.
        scaleX: { from: item.baseScaleX, to: item.baseScaleX * 1.5 },
        scaleY: { from: item.baseScaleY, to: item.baseScaleY * 1.5 },
        duration: 300,
        paused: true,
        yoyo: true,
        // Keep the tween around after completion so repeated clicks can restart it.
        persist: true,
        ease: 'Quad.easeInOut',
        onComplete: () => {
          // Safety net: ensure we always return to baseline.
          this.resetItemToHome(item);

          // If this correct click is supposed to advance, do it exactly after the animation finishes.
          if (this.awaitingNextQuestion) {
            this.awaitingNextQuestion = false;
            this.showNextQuestion();
          }
        }
      });

      // Wrong answer feedback: match the "correct" pop style, just smaller + with a brief red tint.
      // Add a quick sideways knockback so failure feels crisp without moving the item off its slot.
      item.wrongTween = this.tweens.add({
        targets: item,
        // Force baseline start so it never dips smaller first.
        scaleX: { from: item.baseScaleX, to: item.baseScaleX * 1.18 },
        scaleY: { from: item.baseScaleY, to: item.baseScaleY * 1.18 },
        x: {
          from: item.homeX,
          to: item.homeX + 12
        },
        angle: {
          from: item.baseAngle,
          to: item.baseAngle + 4
        },
        duration: 65,
        paused: true,
        yoyo: true,
        repeat: 2,
        persist: true,
        ease: 'Quad.easeInOut',
        onStart: () => {
          item.setTint(0xff6b6b);
          this.cameras.main.shake(90, 0.0025, true);
        },
        onComplete: () => {
          this.resetItemToHome(item);
        }
      });

      // transparency tween
      item.alphaTween = this.tweens.add({
        targets: item,
        alpha: 0.7,
        duration: 200,
        paused: true,
        // Keep around so hover keeps working reliably over time.
        persist: true
      });

      // create sound for each word
      this.words[i].sound = this.sound.add(item.texture.key + 'Audio');

      // listen to the pointerdown event
      item.on('pointerdown', () => {
        this.selectItem(item);
      });

      // listen to the pointerover event
      item.on('pointerover', () => {
        item.alphaTween.play();
      });

      // listen to the pointerout event
      item.on('pointerout', () => {
        //stop alpha tween
        item.alphaTween.stop();
        // set no transparency
        item.alpha = 1;
      });
    }

    // text object
    this.wordText = this.add.text(30, 20, ' ', {
      font: '28px Open Sans',
      fill: '#ffffff'
    });

    // allow tapping/clicking the current word to replay its audio
    this.wordText.setInteractive({ useHandCursor: true });
    this.wordText.on('pointerdown', () => {
      if (this.awaitingNextQuestion || this.inputLocked) {
        return;
      }

      this.currentPromptSound?.stop();
      this.replayCurrentPrompt();
    });

    this.scoreText = this.add
      .text(this.scale.width - 30, 20, '', {
        font: '18px Open Sans',
        fill: '#ffffff'
      })
      .setOrigin(1, 0);

    this.updateScoreText();

    this.muteText = this.add.text(30, 55, '', {
      font: '16px Open Sans',
      fill: '#ffffff'
    });

    // allow tapping/clicking the hint text to toggle SFX mute
    this.muteText.setInteractive({ useHandCursor: true });
    this.muteText.on('pointerdown', () => {
      this.sfxMuted = !this.sfxMuted;
      this.correctSound?.setMute(this.sfxMuted);
      this.wrongSound?.setMute(this.sfxMuted);
      this.updateMuteText();
    });

    this.updateMuteText();

    this.feedbackText = this.add
      .text(30, 85, '', {
        font: '16px Open Sans',
        fill: '#ffffff'
      })
      .setAlpha(0);

    // On-screen controls (show on touch devices only to avoid crowding desktop HUD).
    const isTouchDevice = this.sys.game.device.input.touch;
    if (isTouchDevice) {
      this.muteButton = this.add
        .text(30, 80, '[SFX]', {
          font: '16px Open Sans',
          fill: '#ffffaa'
        })
        .setInteractive({ useHandCursor: true });

      this.muteButton.on('pointerdown', () => {
        this.sfxMuted = !this.sfxMuted;
        this.correctSound?.setMute(this.sfxMuted);
        this.wrongSound?.setMute(this.sfxMuted);
        this.updateMuteText();
      });

      this.replayButton = this.add
        .text(90, 80, '[Replay]', {
          font: '16px Open Sans',
          fill: '#ffffaa'
        })
        .setInteractive({ useHandCursor: true });

      this.replayButton.on('pointerdown', () => {
        if (this.awaitingNextQuestion || this.inputLocked) {
          return;
        }

        this.currentPromptSound?.stop();
        this.replayCurrentPrompt();
      });
    }

    // keyboard shortcut: press M to mute/unmute SFX (keeps lesson audio)
    this.input.keyboard?.on('keydown-M', () => {
      this.sfxMuted = !this.sfxMuted;
      this.correctSound?.setMute(this.sfxMuted);
      this.wrongSound?.setMute(this.sfxMuted);
      this.updateMuteText();
    });

    // keyboard shortcut: press R to replay the current word audio
    this.input.keyboard?.on('keydown-R', () => {
      if (this.awaitingNextQuestion || this.inputLocked) {
        return;
      }

      this.currentPromptSound?.stop();
      this.replayCurrentPrompt();
    });

    // keyboard shortcut: press N to skip to a new prompt (doesn't affect score/attempts)
    this.input.keyboard?.on('keydown-N', () => {
      if (this.awaitingNextQuestion || this.inputLocked) {
        return;
      }

      this.awaitingNextQuestion = true;
      this.showNextQuestion();
      this.awaitingNextQuestion = false;
    });

    // keyboard shortcut: press 1-4 to pick the current left-to-right item order
    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      const shortcutIndex = Number.parseInt(event.key, 10);

      if (!Number.isInteger(shortcutIndex) || shortcutIndex < 1 || shortcutIndex > 4) {
        return;
      }

      const orderedItems = [...this.itemSprites].sort((left, right) => left.x - right.x);
      const selectedItem = orderedItems[shortcutIndex - 1];

      if (!selectedItem) {
        return;
      }

      this.selectItem(selectedItem);
    });

    // correct / wrong sounds
    this.correctSound = this.sound.add('correct');
    this.wrongSound = this.sound.add('wrong');

    // if the user toggled mute before these sounds existed, apply it now
    this.correctSound.setMute(this.sfxMuted);
    this.wrongSound.setMute(this.sfxMuted);

    this.showNextQuestion();
  }

  processAnswer(userResponse?: string) {
    this.attempts += 1;

    // compare user response with correct response
    if (userResponse === this.nextWord.translation) {
      // it's correct

      this.score += 1;
      this.recordPromptResult(true);

      // play sound
      this.correctSound.play();
      this.updateShufflePace(true);

      this.updateScoreText();
      this.showFeedback(true);

      return true;
    } else {
      // it's wrong
      this.recordPromptResult(false);

      // play sound
      this.wrongSound.play();
      this.updateShufflePace(false);

      this.updateScoreText();
      this.showFeedback(false);

      return false;
    }
  }

  showFeedback(correct: boolean) {
    const text = correct ? 'Correct!' : 'Try again';
    const color = correct ? '#65f26a' : '#ff6b6b';

    this.feedbackText.setText(text);
    this.feedbackText.setColor(color);
    this.feedbackText.setAlpha(1);

    this.feedbackTween?.stop();
    this.feedbackTween = this.tweens.add({
      targets: this.feedbackText,
      alpha: 0,
      duration: 500,
      delay: 350,
      ease: 'Quad.easeOut'
    });
  }

  updateScoreText() {
    const percent = this.attempts ? Math.round((this.score / this.attempts) * 100) : 0;
    this.scoreText.setText(`Score: ${this.score}/${this.attempts} (${percent}%)`);
  }

  updateMuteText() {
    // Show keyboard shortcuts in the HUD so they're discoverable.
    this.muteText.setText(
      `SFX: ${this.sfxMuted ? 'OFF' : 'ON'} (tap/M)  •  Pick: 1-4  •  Replay: R  •  Next: N`
    );
  }

  selectItem(item: LearnObject) {
    if (this.awaitingNextQuestion || this.inputLocked) {
      return;
    }

    const itemIndex = this.itemSprites.indexOf(item);

    if (itemIndex === -1) {
      return;
    }

    const result = this.processAnswer(this.words[itemIndex].translation);

    // depending on the result, we'll play one tween or the other
    if (result) {
      this.awaitingNextQuestion = true;

      // Stop prompt audio immediately on correct to avoid overlap with the next word.
      this.currentPromptSound?.stop();

      // Ensure correct feedback is always visible and doesn't leave the item in a weird state.
      item.alphaTween.stop();
      this.resetItemToHome(item);
      item.correctTween.stop();
      item.correctTween.restart();

      // Advance happens in the correct tween onComplete callback (so it always stays in sync).
      return;
    }

    this.inputLocked = true;

    // If the player clicks wrong repeatedly, make sure the feedback always replays.
    item.alphaTween.stop();
    this.resetItemToHome(item);
    item.wrongTween.stop();
    item.wrongTween.restart();

    this.time.delayedCall(500, () => {
      this.inputLocked = false;
      this.replayCurrentPrompt();
    });
  }

  replayCurrentPrompt() {
    this.currentPromptSound?.stop();
    this.currentPromptSound?.play();
  }

  resetItemToHome(item: LearnObject) {
    item.moveTween?.stop();
    item.clearTint();
    item.setAngle(item.baseAngle);
    item.setAlpha(item.baseAlpha);
    item.setScale(item.baseScaleX, item.baseScaleY);
    item.setPosition(item.homeX, item.homeY);
  }

  updateShufflePace(correct: boolean) {
    if (correct) {
      this.correctStreak = Math.min(this.correctStreak + 1, 5);
      const paceBoost = this.correctStreak >= 2 ? 0.18 : 0.08;
      this.shufflePace = Math.min(this.shufflePace + paceBoost, 1);
      return;
    }

    this.correctStreak = 0;
    this.shufflePace = Math.max(this.shufflePace - 0.35, 0);
  }

  recordPromptResult(correct: boolean) {
    const promptKey = this.nextWord?.key as string | undefined;

    if (!promptKey) {
      return;
    }

    const progress = this.promptProgress[promptKey];

    if (!progress) {
      return;
    }

    if (correct) {
      progress.wrongStreak = 0;
      progress.misses = Math.max(progress.misses - 1, 0);
      return;
    }

    progress.misses += 1;
    progress.wrongStreak += 1;
  }

  pickWeightedPrompt(candidateWords: LearnObjectConfig[]) {
    const weightedWords = candidateWords.map((word) => {
      const progress = this.promptProgress[word.key as string];
      const weight = 1 + (progress?.misses ?? 0) + (progress?.wrongStreak ?? 0) * 2;

      return { word, weight };
    });
    const totalWeight = weightedWords.reduce((sum, entry) => sum + entry.weight, 0);
    let target = Phaser.Math.RND.frac() * totalWeight;

    for (const entry of weightedWords) {
      target -= entry.weight;
      if (target <= 0) {
        return entry.word;
      }
    }

    return weightedWords[weightedWords.length - 1].word;
  }

  shuffleItemHomes(onComplete: () => void) {
    const shuffledSlots = Phaser.Utils.Array.Shuffle([...this.homeSlots]);
    let remainingTweens = this.itemSprites.length;
    const duration = Math.round(Phaser.Math.Linear(260, 185, this.shufflePace));
    const stagger = Math.round(Phaser.Math.Linear(35, 18, this.shufflePace));

    if (!remainingTweens) {
      onComplete();
      return;
    }

    this.itemSprites.forEach((item, index) => {
      // Stop any previous movement tween, but DON'T snap back to the old home slot.
      // Snapping causes a visible “teleport” and feels unnatural.
      item.moveTween?.stop();
      item.moveTween = undefined;

      // Reset visuals (scale/tint/alpha), but keep current x/y as the start of the new movement.
      item.clearTint();
      item.setAngle(item.baseAngle);
      item.setAlpha(item.baseAlpha);
      item.setScale(item.baseScaleX, item.baseScaleY);

      const nextSlot = shuffledSlots[index];
      item.homeX = nextSlot.x;
      // Keep a consistent baseline across all objects.
      item.homeY = this.homeBaselineY - item.displayHeight * (1 - item.originY);

      item.moveTween = this.tweens.add({
        targets: item,
        x: item.homeX,
        y: item.homeY,
        duration,
        // Readability comes first: the shuffle only gets a little brisker as the player settles in.
        delay: index * stagger,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          item.moveTween = undefined;
          // Snap to exact target to avoid drift + avoid subpixel blur.
          item.setPosition(Math.round(item.homeX), Math.round(item.homeY));

          remainingTweens -= 1;
          if (remainingTweens === 0) {
            onComplete();
          }
        }
      });
    });
  }

  showNextQuestion() {
    // Bias toward recent misses, but still avoid immediate repeats when there's another option.
    const candidateWords = this.words.filter((w) => w.key !== this.lastWordKey);
    const availableWords = candidateWords.length ? candidateWords : this.words;

    this.nextWord = this.pickWeightedPrompt(availableWords);
    this.lastWordKey = this.nextWord.key as string;
    this.wordText.setText(this.nextWord.translation ?? '');
    this.currentPromptSound?.stop();
    this.inputLocked = true;

    this.shuffleItemHomes(() => {
      // play a sound for that word after the shuffle so movement and prompt stay in sync
      this.currentPromptSound = this.nextWord.sound;
      this.replayCurrentPrompt();
      this.inputLocked = false;
    });
  }
}
