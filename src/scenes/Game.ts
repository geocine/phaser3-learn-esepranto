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
  correctSound: Phaser.Sound.BaseSound;
  wrongSound: Phaser.Sound.BaseSound;

  private lastWordKey?: string;
  private awaitingNextQuestion = false;
  private score = 0;
  private attempts = 0;

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

      // creating tween - resize tween
      item.correctTween = this.tweens.add({
        targets: item,
        scaleX: 1.5,
        scaleY: 1.5,
        duration: 300,
        paused: true,
        yoyo: true,
        ease: 'Quad.easeInOut'
      });

      item.wrongTween = this.tweens.add({
        targets: item,
        scaleX: 1.5,
        scaleY: 1.5,
        duration: 300,
        angle: 90,
        paused: true,
        yoyo: true,
        ease: 'Quad.easeInOut'
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
        if (this.awaitingNextQuestion) {
          return;
        }

        this.awaitingNextQuestion = true;

        const result = this.processAnswer(this.words[i].translation);

        // depending on the result, we'll play one tween or the other
        if (result) {
          item.correctTween.play();
        } else {
          item.wrongTween.play();
        }

        // show next question (use Phaser clock so it respects pause/time scale)
        this.time.delayedCall(800, () => {
          this.awaitingNextQuestion = false;
          this.showNextQuestion();
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

    this.scoreText = this.add
      .text(this.scale.width - 30, 20, '', {
        font: '18px Open Sans',
        fill: '#ffffff'
      })
      .setOrigin(1, 0);

    this.updateScoreText();

    // correct / wrong sounds
    this.correctSound = this.sound.add('correct');
    this.wrongSound = this.sound.add('wrong');

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

      return true;
    } else {
      // it's wrong

      // play sound
      this.wrongSound.play();

      this.updateScoreText();

      return false;
    }
  }

  updateScoreText() {
    const percent = this.attempts ? Math.round((this.score / this.attempts) * 100) : 0;
    this.scoreText.setText(`Score: ${this.score}/${this.attempts} (${percent}%)`);
  }

  showNextQuestion() {
    // select a random word (avoid repeating the same prompt twice in a row)
    const candidateWords = this.words.filter((w) => w.key !== this.lastWordKey);

    this.nextWord = Phaser.Math.RND.pick(candidateWords.length ? candidateWords : this.words);
    this.lastWordKey = this.nextWord.key as string;

    // play a sound for that word
    this.nextWord.sound.play();

    this.wordText.setText(this.nextWord.translation);
  }
}
