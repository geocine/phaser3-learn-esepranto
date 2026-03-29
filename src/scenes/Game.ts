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
  private awaitingNextQuestion = false;
  private inputLocked = false;
  private sfxMuted = false;
  private score = 0;
  private attempts = 0;

  private currentPromptSound?: Phaser.Sound.BaseSound;
  private itemSprites: LearnObject[] = [];
  private homeSlots: HomeSlot[] = [];

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
  }

  create() {
    this.items = this.add.group(this.words);

    // background
    this.add.sprite(0, 0, 'background').setOrigin(0, 0);

    // show group sprites on top of the background
    this.items.setDepth(1);

    this.itemSprites = this.items.getChildren() as LearnObject[];
    this.homeSlots = this.itemSprites.map((item) => ({
      x: item.x,
      y: item.y
    }));

    for (let i = 0; i < this.itemSprites.length; i++) {
      const item = this.itemSprites[i];

      // make item interactive
      item.setInteractive();

      // Cache baseline transform so we can always snap back after feedback tweens.
      item.homeX = item.x;
      item.homeY = item.y;
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
        }
      });

      // Wrong answer feedback: match the "correct" pop style, just smaller + with a brief red tint.
      // This keeps the motion consistent and kid-friendly.
      item.wrongTween = this.tweens.add({
        targets: item,
        // Force baseline start so it never dips smaller first.
        scaleX: { from: item.baseScaleX, to: item.baseScaleX * 1.18 },
        scaleY: { from: item.baseScaleY, to: item.baseScaleY * 1.18 },
        duration: 220,
        paused: true,
        yoyo: true,
        persist: true,
        ease: 'Quad.easeInOut',
        onStart: () => {
          item.setTint(0xff6b6b);
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
        if (this.awaitingNextQuestion || this.inputLocked) {
          return;
        }

        const result = this.processAnswer(this.words[i].translation);

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

          // Advance only after the correct animation completes (feels paced and avoids audio overlap).
          // `persist: true` means the tween is reused, so clear any prior complete handlers.
          item.correctTween.off('complete');
          item.correctTween.once('complete', () => {
            this.awaitingNextQuestion = false;
            this.showNextQuestion();
          });

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

      // play sound
      this.correctSound.play();

      this.updateScoreText();
      this.showFeedback(true);

      return true;
    } else {
      // it's wrong

      // play sound
      this.wrongSound.play();

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
      `SFX: ${this.sfxMuted ? 'OFF' : 'ON'} (tap hint / M)  •  Replay: R  •  Next: N`
    );
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

  shuffleItemHomes(onComplete: () => void) {
    const shuffledSlots = Phaser.Utils.Array.Shuffle([...this.homeSlots]);
    let remainingTweens = this.itemSprites.length;

    if (!remainingTweens) {
      onComplete();
      return;
    }

    this.itemSprites.forEach((item, index) => {
      this.resetItemToHome(item);

      const nextSlot = shuffledSlots[index];
      item.homeX = nextSlot.x;
      item.homeY = nextSlot.y;
      item.moveTween = this.tweens.add({
        targets: item,
        x: item.homeX,
        y: item.homeY,
        duration: 220,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          item.moveTween = undefined;
          remainingTweens -= 1;

          if (remainingTweens === 0) {
            onComplete();
          }
        }
      });
    });
  }

  showNextQuestion() {
    // select a random word (avoid repeating the same prompt twice in a row)
    const candidateWords = this.words.filter((w) => w.key !== this.lastWordKey);

    this.nextWord = Phaser.Math.RND.pick(candidateWords.length ? candidateWords : this.words);
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
