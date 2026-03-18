import Phaser from 'phaser';

type LearnObject = Phaser.GameObjects.BitmapText & {
  correctTween?: Phaser.Tweens.Tween;
  wrongTween?: Phaser.Tweens.Tween;
  alphaTween?: Phaser.Tweens.Tween;
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

    let items = this.items.getChildren();

    for (let i = 0; i < items.length; i++) {
      const item: LearnObject = items[i] as LearnObject;

      // make item interactive
      item.setInteractive();

      // Cache baseline transform so we can always snap back after feedback tweens.
      const baseX = item.x;
      const baseY = item.y;
      const baseScaleX = item.scaleX;
      const baseScaleY = item.scaleY;
      const baseAngle = item.angle;
      const baseAlpha = item.alpha;

      // Correct answer feedback: subtle pop (no large scale that can feel like it “jumps away”).
      item.correctTween = this.tweens.add({
        targets: item,
        scaleX: baseScaleX * 1.18,
        scaleY: baseScaleY * 1.18,
        duration: 120,
        paused: true,
        yoyo: true,
        ease: 'Sine.easeOut',
        onComplete: () => {
          item.setAngle(baseAngle);
          item.setAlpha(baseAlpha);
          item.setScale(baseScaleX, baseScaleY);
          item.setPosition(baseX, baseY);
        }
      });

      // Wrong answer feedback: a quick shake + scale pulse.
      // (Avoid large rotation here; depending on device/browser it can look like the sprite vanishes.)

      item.wrongTween = this.tweens.add({
        targets: item,
        // Keep scale subtle; the main cue should be a quick shake.
        scaleX: baseScaleX * 1.12,
        scaleY: baseScaleY * 1.12,
        x: baseX + 12,
        duration: 55,
        paused: true,
        yoyo: true,
        repeat: 4,
        ease: 'Sine.easeInOut',
        onComplete: () => {
          // Ensure we always snap back to a clean state.
          item.setAngle(0);
          item.setScale(baseScaleX, baseScaleY);
          item.setX(baseX);
        }
      });

      // transparency tween
      item.alphaTween = this.tweens.add({
        targets: item,
        alpha: 0.7,
        duration: 200,
        paused: true
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

          // Ensure correct feedback is always visible and doesn't leave the item in a weird state.
          item.alphaTween.stop();
          item.setAngle(baseAngle);
          item.setAlpha(baseAlpha);
          item.setScale(baseScaleX, baseScaleY);
          item.setPosition(baseX, baseY);
          item.correctTween.stop();
          item.correctTween.restart();

          // show next question (use Phaser clock so it respects pause/time scale)
          this.time.delayedCall(800, () => {
            this.awaitingNextQuestion = false;
            this.showNextQuestion();
          });

          return;
        }

        this.inputLocked = true;

        // If the player clicks wrong repeatedly, make sure the feedback always replays.
        item.alphaTween.stop();
        item.wrongTween.stop();
        item.setAngle(baseAngle);
        item.setAlpha(baseAlpha);
        item.setScale(baseScaleX, baseScaleY);
        item.setPosition(baseX, baseY);
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
      if (this.awaitingNextQuestion) {
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
        if (this.awaitingNextQuestion) {
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
      if (this.awaitingNextQuestion) {
        return;
      }

      this.currentPromptSound?.stop();
      this.replayCurrentPrompt();
    });

    // keyboard shortcut: press N to skip to a new prompt (doesn't affect score/attempts)
    this.input.keyboard?.on('keydown-N', () => {
      if (this.awaitingNextQuestion) {
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
    this.muteText.setText(`SFX: ${this.sfxMuted ? 'OFF' : 'ON'} (tap hint / M)`);
  }

  replayCurrentPrompt() {
    this.currentPromptSound?.stop();
    this.currentPromptSound?.play();
  }

  showNextQuestion() {
    // select a random word (avoid repeating the same prompt twice in a row)
    const candidateWords = this.words.filter((w) => w.key !== this.lastWordKey);

    this.nextWord = Phaser.Math.RND.pick(candidateWords.length ? candidateWords : this.words);
    this.lastWordKey = this.nextWord.key as string;

    // play a sound for that word (stop previous prompt so it doesn't overlap)
    this.currentPromptSound = this.nextWord.sound;
    this.replayCurrentPrompt();

    this.wordText.setText(this.nextWord.translation);
  }
}
