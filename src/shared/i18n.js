// Two languages: English and Catalan. The choice is saved as gh:app:lang.
import { createStore } from './storage.js';

const store = createStore('app');
export const LANGS = ['en', 'ca'];

const STRINGS = {
  en: {
    'common.back': 'Back to games',
    'common.cancel': 'Cancel',
    'common.close': 'Close',
    'common.menu': 'Menu',
    'common.copy': 'Copy',
    'common.copied': 'Copied',
    'common.share': 'Share',
    'common.yes': 'Yes',
    'common.no': 'No',
    'common.undo': 'Undo',
    'common.redo': 'Redo',
    'common.newGame': 'New game',
    'common.resume': 'Resume',

    'launcher.games': 'All games',
    'launcher.suggested': 'Suggested',
    'launcher.play': 'Play',
    'launcher.resume': 'Resume',
    'launcher.playGame': 'Play {name}',
    'launcher.resumeGame': 'Resume {name}',
    'launcher.downloadGame': 'Download {name}',
    'launcher.retryGame': 'Download {name} again: the last try failed',
    'launcher.downloadingGame': 'Downloading {name}, {p}',
    'launcher.queuedGame': '{name}, waiting to download',
    'launcher.needsHostGame': 'Go online to download {name}',
    'launcher.downloadFailed': 'Download failed. Tap the game to try again.',
    'launcher.settings': 'Settings',

    'status.checking': 'Checking offline files…',
    'status.preparing': 'Preparing the app… {done}/{total}',
    'status.preparingTitle': 'Preparing the app',
    'status.files': '{done} / {total} files',
    'status.downloadingHint': 'Keep the app open and stay online. When the logo is sharp, the app opens without a connection.',
    'status.line.ready': 'Ready offline · {n} of {total} games',
    'status.line.all': 'Ready offline',
    'status.line.offline': 'Offline · {n} of {total} games',
    'status.line.downloading': 'Downloading · {p}',
    'status.hostOffline': 'Offline. Downloaded games still work.',
    'status.failed': 'Download failed',
    'status.failedHint': 'Check the connection, then close and reopen the app.',
    'status.unsupported': 'Offline mode unavailable',
    'status.unsupportedHint': 'Open this page in Safari over https.',

    'prepare.note': 'Games show up here once the app is ready.',

    'install.title': 'Install the app',
    'install.lead': 'Games that keep working in airplane mode. They come into focus once the app is on your Home Screen.',
    'install.step.share': 'Tap Share',
    'install.step.add': 'Add to Home Screen',
    'install.step.menu': 'Open the browser menu',
    'install.step.install': 'Install the app or add it to the Home Screen',
    'install.step.open': 'Open it from the new icon',
    'install.note': 'Games are downloaded inside the installed app, where you choose the ones you want.',

    'update.text': 'Update available. Tap to reload and update.',
    'update.action': 'Update',

    'settings.title': 'Settings',
    'settings.language': 'Language',
    'settings.sound': 'Sound',
    'settings.soundEffects': 'Sound effects',
    'settings.saves': 'Saves',
    'settings.export': 'Export saves',
    'settings.import': 'Import saves',
    'settings.exported': 'Exported {n} entries.',
    'settings.nothing': 'Nothing saved yet.',
    'settings.importConfirm': 'Import {n} entries? Entries with the same name will be replaced.',
    'settings.import.do': 'Import',
    'settings.imported': 'Imported {n} entries.',
    'settings.importError': "That file isn't a Cache Only save file.",
    'settings.device': 'This phone',
    'settings.version': 'Version',
    'settings.games': 'Games downloaded',
    'settings.check': 'Check for update',
    'settings.checking': 'Checking…',
    'settings.noUpdates': 'No updates',
    'settings.unreachable': 'Offline. Try later',
    'settings.updateFailed': 'Download failed. Try again',

    'difficulty.easy': 'Easy',
    'difficulty.medium': 'Medium',
    'difficulty.hard': 'Hard',
    'difficulty.expert': 'Expert',
    'difficulty.custom': 'Custom',

    'sudoku.givens': '{min}–{max} given numbers',
    'sudoku.generating': 'Generating…',
    'sudoku.resume': 'Resume',
    'sudoku.start': 'Start',
    'sudoku.bestTime': 'Best {time}',
    'sudoku.allPlaced': '{d}, all placed',
    'sudoku.notes': 'Notes',
    'sudoku.erase': 'Erase',
    'sudoku.hint': 'Hint',
    'sudoku.newPuzzle': 'New puzzle',
    'sudoku.confirmNew': 'Start a new puzzle? The current one will be lost.',
    'sudoku.enter': 'Enter puzzle',
    'sudoku.enterHelp': 'Paste 81 digits, row by row. Use 0 or . for empty cells.',
    'sudoku.enterPlay': 'Play this puzzle',
    'sudoku.checking': 'Checking…',
    'sudoku.err.length': 'Needs exactly 81 cells; this has {n}.',
    'sudoku.err.chars': 'Only digits 0–9 and . are allowed.',
    'sudoku.err.conflict': 'Two equal numbers share a row, column or box.',
    'sudoku.err.none': 'This puzzle has no solution.',
    'sudoku.err.multiple': 'This puzzle has more than one solution.',
    'sudoku.share': 'Share this puzzle',
    'sudoku.shareHelp': 'Send these 81 digits to a friend. They paste them into Enter puzzle.',
    'sudoku.showConflicts': 'Show conflicts',
    'sudoku.solved': 'Solved!',
    'sudoku.time': 'Time',
    'sudoku.hints': 'Hints',
    'sudoku.difficulty': 'Difficulty',
    'sudoku.newBest': 'New best time!',
    'sudoku.best': 'Best times',
    'sudoku.cell': 'Row {r}, column {c}',
    'sudoku.empty': 'empty',
    'sudoku.notesList': 'notes {list}',
    'sudoku.board': 'Sudoku board',

    'g2048.score': 'Score',
    'g2048.best': 'Best',
    'g2048.won': 'You made 2048!',
    'g2048.wonText': 'Keep going for a bigger tile, or start over.',
    'g2048.keepPlaying': 'Keep playing',
    'g2048.over': 'No moves left',
    'g2048.overText': 'Final score {score}.',
    'g2048.hint': 'Swipe on the board',
    'g2048.confirmNew': 'Start a new game? This one will be lost.',
    'g2048.board': '2048 board',

    'tanks.title': 'Tanks',
    'tanks.board': 'Tank battle arena',
    'tanks.mission': 'Mission',
    'tanks.missionN': 'Mission {n}',
    'tanks.lives': 'Lives',
    'tanks.resume': 'Resume',
    'tanks.quit': 'Quit campaign',
    'tanks.confirmQuit': 'Quit this campaign? Its progress will be lost.',
    'tanks.intro': 'Shells bounce off walls once. Mines blow up striped crates. Clear all 20 missions.',
    'tanks.start': 'Start',
    'tanks.continue': 'Continue · mission {n}',
    'tanks.newCampaign': 'New campaign',
    'tanks.confirmNew': 'Start a new campaign? The current one will be lost.',
    'tanks.startAt': 'Start at',
    'tanks.record': 'Record: {kills} tanks · mission {mission}',
    'tanks.recordAll': 'Record: {kills} tanks · all missions cleared',
    'tanks.helpTouch': 'Put a thumb anywhere on the bottom left to drive. On the bottom right, drag to aim and let go to fire, or drag back to the middle to cancel. While the aim stick shines, a quick tap fires at the tank your turret is following; otherwise it fires where you last aimed. The bomb button lays a mine; the icons under Mission and Lives show the shells and mines you have ready.',
    'tanks.helpKeys': 'WASD or the arrow keys drive. Aim with the mouse and click to fire. Space or right-click lays a mine. P pauses.',
    'tanks.enemies': 'Enemy tanks: {n}',
    'tanks.final': 'Final mission',
    'tanks.note.white': 'Some tanks here turn invisible. Watch for their tracks.',
    'tanks.note.red': 'Missiles here follow you. Shoot them down or lead them into a wall.',
    'tanks.note.olive': 'Mortars here lob bombs over walls. Get off the marks on the floor, or get in close.',
    'tanks.note.lime': 'Miniguns here whine as they spin up, then fire non-stop. Be behind a wall before they start.',
    'tanks.note.hornet': 'Hornets here mine the way to them, then shoot a mine the moment you pass it. Give every mine a wide berth.',
    'tanks.cleared': 'Mission cleared!',
    'tanks.bonus': 'Bonus tank!',
    'tanks.destroyed': 'Tank destroyed',
    'tanks.livesLeft': 'Lives left: {n}',
    'tanks.gameOver': 'Game over',
    'tanks.victory': 'All missions cleared!',
    'tanks.victoryShort': 'Campaign cleared!',
    'tanks.reached': 'Mission reached',
    'tanks.destroyedCount': 'Tanks destroyed',
    'tanks.newRecord': 'New record!',
    'tanks.playAgain': 'Play again',
    'tanks.pads': 'Touch controls: the bottom left drives, the bottom right aims and fires',
    'tanks.mine': 'Lay a mine',
    'tanks.ammo': 'Shells ready: {shells} of {maxShells}. Mines ready: {mines} of {maxMines}.',
    'tanks.type.brown': 'Brown',
    'tanks.type.ash': 'Grey',
    'tanks.type.marine': 'Teal',
    'tanks.type.yellow': 'Yellow',
    'tanks.type.pink': 'Pink',
    'tanks.type.green': 'Green',
    'tanks.type.violet': 'Violet',
    'tanks.type.white': 'White',
    'tanks.type.black': 'Black',
    'tanks.type.red': 'Red',
    'tanks.type.olive': 'Olive',
    'tanks.type.lime': 'Lime',
    'tanks.type.hornet': 'Hornet',
    'tanks.test': 'Test',
    'tanks.testTitle': 'Test range',
    'tanks.testIntro': 'Four walls, you on the left and the enemies you pick on the right. Nothing here counts toward your record.',
    'tanks.testEnemy': 'Enemy',
    'tanks.testCount': 'How many',
    'tanks.testStart': 'Start test',
    'tanks.testEnd': 'End test',
    'tanks.testCleared': 'Test cleared!',
    'tanks.name.1': 'First contact',
    'tanks.name.2': 'Crossfire',
    'tanks.name.3': 'Patrol',
    'tanks.name.4': 'Crate gate',
    'tanks.name.5': 'Rocket range',
    'tanks.name.6': 'Switchbacks',
    'tanks.name.7': 'Bank shots',
    'tanks.name.8': 'Across the pits',
    'tanks.name.9': 'The maze',
    'tanks.name.10': 'Mirror match',
    'tanks.name.11': 'Pillboxes',
    'tanks.name.12': 'Lock-on',
    'tanks.name.13': 'Ghosts',
    'tanks.name.14': 'Hunter',
    'tanks.name.15': 'Artillery',
    'tanks.name.16': 'Crossroads',
    'tanks.name.17': 'Fortress',
    'tanks.name.18': 'Night shift',
    'tanks.name.19': 'Siege',
    'tanks.name.20': 'Last stand',
    'tanks.brief.1': 'One turret behind a wall. Drive round it, or bounce a shell in.',
    'tanks.brief.2': 'Three turrets cover the middle. Take them one at a time.',
    'tanks.brief.3': 'They patrol round the big block. Wait for them at a corner.',
    'tanks.brief.4': 'Striped crates stop shells. A mine blows them open.',
    'tanks.brief.5': 'Rockets never bounce: keep a pillar between you.',
    'tanks.brief.6': 'The corridors fold back on themselves. Watch the floor for mines.',
    'tanks.brief.7': "Shells bounce round corners here. A wall isn't always cover.",
    'tanks.brief.8': 'Shells fly over the holes. Tanks cross at the bridge.',
    'tanks.brief.9': 'Blind corners everywhere. Mind your own ricochets.',
    'tanks.brief.10': 'Two tanks with your loadout, in an arena that mirrors itself.',
    'tanks.brief.11': 'Two turrets in walled pockets. Work your way round them.',
    'tanks.brief.12': 'Pillars everywhere: keep one between you and each missile.',
    'tanks.brief.13': 'Crate alcoves everywhere, and something hiding in them.',
    'tanks.brief.14': 'A fast hunter. Use the loops to shake it off.',
    'tanks.brief.15': 'Two walled yards. Clear the open ground, then storm them.',
    'tanks.brief.16': 'Four arms and no cover in the middle. Cross fast.',
    'tanks.brief.17': 'The gates are crates. Bring mines.',
    'tanks.brief.18': 'Short walls, long shadows, and ghosts among them.',
    'tanks.brief.19': 'Mortars behind the line, hunters in front. Break through.',
    'tanks.brief.20': 'Every kind of tank at once. Good luck.',
  },

  ca: {
    'common.back': 'Torna als jocs',
    'common.cancel': 'Cancel·la',
    'common.close': 'Tanca',
    'common.menu': 'Menú',
    'common.copy': 'Copia',
    'common.copied': 'Copiat',
    'common.share': 'Comparteix',
    'common.yes': 'Sí',
    'common.no': 'No',
    'common.undo': 'Desfés',
    'common.redo': 'Refés',
    'common.newGame': 'Partida nova',
    'common.resume': 'Continua',

    'launcher.games': 'Tots els jocs',
    'launcher.suggested': 'Suggeriment',
    'launcher.play': 'Juga',
    'launcher.resume': 'Continua',
    'launcher.playGame': 'Juga a {name}',
    'launcher.resumeGame': 'Continua {name}',
    'launcher.downloadGame': 'Baixa {name}',
    'launcher.retryGame': "Torna a baixar {name}: l'últim intent ha fallat",
    'launcher.downloadingGame': 'Baixant {name}, {p}',
    'launcher.queuedGame': '{name}, esperant per baixar-se',
    'launcher.needsHostGame': "Connecta't a internet per baixar {name}",
    'launcher.downloadFailed': "No s'ha pogut baixar. Toca el joc per tornar-ho a provar.",
    'launcher.settings': 'Configuració',

    'status.checking': 'Comprovant els fitxers…',
    'status.preparing': "Preparant l'app… {done}/{total}",
    'status.preparingTitle': "Preparant l'app",
    'status.files': '{done} / {total} fitxers',
    'status.downloadingHint': "Mantén l'app oberta i amb connexió. Quan el logo es vegi nítid, l'app s'obrirà sense connexió.",
    'status.line.ready': 'Llest sense connexió · {n} de {total} jocs',
    'status.line.all': 'Llest sense connexió',
    'status.line.offline': 'Sense connexió · {n} de {total} jocs',
    'status.line.downloading': 'Baixant · {p}',
    'status.hostOffline': 'Sense connexió. Els jocs baixats funcionen igualment.',
    'status.failed': 'Ha fallat la baixada',
    'status.failedHint': "Comprova la connexió i torna a obrir l'app.",
    'status.unsupported': 'Mode sense connexió no disponible',
    'status.unsupportedHint': 'Obre aquesta pàgina amb Safari per https.',

    'prepare.note': "Els jocs apareixeran aquí quan l'app estigui llesta.",

    'install.title': "Instal·la l'app",
    'install.lead': "Jocs que funcionen en mode avió. Es veuen nítids quan l'app és a la pantalla d'inici.",
    'install.step.share': 'Toca Compartir',
    'install.step.add': "Afegeix a la pantalla d'inici",
    'install.step.menu': 'Obre el menú del navegador',
    'install.step.install': "Instal·la l'app o afegeix-la a la pantalla d'inici",
    'install.step.open': "Obre-la des de la icona nova",
    'install.note': "Els jocs es baixen dins l'app instal·lada, on tries els que vulguis.",

    'update.text': 'Hi ha una actualització. Toca per recarregar i actualitzar.',
    'update.action': 'Actualitza',

    'settings.title': 'Configuració',
    'settings.language': 'Idioma',
    'settings.sound': 'So',
    'settings.soundEffects': 'Efectes de so',
    'settings.saves': 'Partides desades',
    'settings.export': 'Exporta les partides',
    'settings.import': 'Importa partides',
    'settings.exported': "S'han exportat {n} elements.",
    'settings.nothing': 'Encara no hi ha res desat.',
    'settings.importConfirm': 'Vols importar {n} elements? Se substituiran els que tinguin el mateix nom.',
    'settings.import.do': 'Importa',
    'settings.imported': "S'han importat {n} elements.",
    'settings.importError': 'Aquest fitxer no és una còpia de partides de Cache Only.',
    'settings.device': 'Aquest telèfon',
    'settings.version': 'Versió',
    'settings.games': 'Jocs baixats',
    'settings.check': 'Cerca actualitzacions',
    'settings.checking': 'Comprovant…',
    'settings.noUpdates': 'Cap actualització',
    'settings.unreachable': 'Sense connexió. Prova-ho després',
    'settings.updateFailed': 'Ha fallat. Torna-ho a provar',

    'difficulty.easy': 'Fàcil',
    'difficulty.medium': 'Mitjà',
    'difficulty.hard': 'Difícil',
    'difficulty.expert': 'Expert',
    'difficulty.custom': 'Personalitzat',

    'sudoku.givens': '{min}–{max} números donats',
    'sudoku.generating': 'Generant…',
    'sudoku.resume': 'Continua',
    'sudoku.start': 'Comença',
    'sudoku.bestTime': 'Millor temps {time}',
    'sudoku.allPlaced': '{d}, tots col·locats',
    'sudoku.notes': 'Notes',
    'sudoku.erase': 'Esborra',
    'sudoku.hint': 'Pista',
    'sudoku.newPuzzle': 'Sudoku nou',
    'sudoku.confirmNew': "Vols començar un sudoku nou? Perdràs l'actual.",
    'sudoku.enter': 'Introdueix un sudoku',
    'sudoku.enterHelp': 'Enganxa 81 xifres, fila per fila. Fes servir 0 o . per a les caselles buides.',
    'sudoku.enterPlay': 'Juga aquest sudoku',
    'sudoku.checking': 'Comprovant…',
    'sudoku.err.length': "Calen exactament 81 caselles; n'hi ha {n}.",
    'sudoku.err.chars': 'Només es permeten xifres del 0 al 9 i el punt.',
    'sudoku.err.conflict': 'Hi ha dos números iguals a la mateixa fila, columna o quadre.',
    'sudoku.err.none': 'Aquest sudoku no té solució.',
    'sudoku.err.multiple': "Aquest sudoku té més d'una solució.",
    'sudoku.share': 'Comparteix aquest sudoku',
    'sudoku.shareHelp': "Envia aquestes 81 xifres a algú. Les pot enganxar a «Introdueix un sudoku».",
    'sudoku.showConflicts': 'Mostra els conflictes',
    'sudoku.solved': 'Resolt!',
    'sudoku.time': 'Temps',
    'sudoku.hints': 'Pistes',
    'sudoku.difficulty': 'Dificultat',
    'sudoku.newBest': 'Nou millor temps!',
    'sudoku.best': 'Millors temps',
    'sudoku.cell': 'Fila {r}, columna {c}',
    'sudoku.empty': 'buida',
    'sudoku.notesList': 'notes {list}',
    'sudoku.board': 'Tauler del sudoku',

    'g2048.score': 'Punts',
    'g2048.best': 'Rècord',
    'g2048.won': 'Has fet 2048!',
    'g2048.wonText': 'Continua per fer una fitxa més gran, o torna a començar.',
    'g2048.keepPlaying': 'Continua jugant',
    'g2048.over': 'No queden moviments',
    'g2048.overText': 'Puntuació final: {score}.',
    'g2048.hint': 'Llisca sobre el tauler',
    'g2048.confirmNew': "Vols començar una partida nova? Perdràs l'actual.",
    'g2048.board': 'Tauler del 2048',

    'tanks.title': 'Tancs',
    'tanks.board': 'Arena de la batalla de tancs',
    'tanks.mission': 'Missió',
    'tanks.missionN': 'Missió {n}',
    'tanks.lives': 'Vides',
    'tanks.resume': 'Continua',
    'tanks.quit': 'Abandona la campanya',
    'tanks.confirmQuit': 'Vols abandonar aquesta campanya? En perdràs el progrés.',
    'tanks.intro': 'Els projectils reboten un cop a les parets. Les mines rebenten les caixes ratllades. Supera les 20 missions.',
    'tanks.start': 'Comença',
    'tanks.continue': 'Continua · missió {n}',
    'tanks.newCampaign': 'Campanya nova',
    'tanks.confirmNew': "Vols començar una campanya nova? Perdràs l'actual.",
    'tanks.startAt': 'Comença a',
    'tanks.record': 'Rècord: {kills} tancs · missió {mission}',
    'tanks.recordAll': 'Rècord: {kills} tancs · totes les missions superades',
    'tanks.helpTouch': "Posa un polze a qualsevol punt de la part de baix a l'esquerra per conduir. A baix a la dreta, arrossega per apuntar i deixa anar per disparar, o torna al centre per cancel·lar. Mentre la palanca d'apuntar brilla, un toc ràpid dispara al tanc que segueix la torreta; si no, dispara cap on has apuntat l'últim cop. El botó de la bomba posa una mina; les icones sota Missió i Vides mostren els projectils i les mines que tens a punt.",
    'tanks.helpKeys': 'WASD o les fletxes condueixen. Apunta amb el ratolí i fes clic per disparar. Espai o clic dret posa una mina. P posa en pausa.',
    'tanks.enemies': 'Tancs enemics: {n}',
    'tanks.final': 'Última missió',
    'tanks.note.white': "Aquí alguns tancs es tornen invisibles. Fixa't en les rodades.",
    'tanks.note.red': 'Aquí els míssils et segueixen. Abat-los o fes que xoquin contra una paret.',
    'tanks.note.olive': "Aquí els morters llancen bombes per sobre de les parets. Surt de les marques del terra, o acosta-t'hi.",
    'tanks.note.lime': "Aquí les metralladores xiulen mentre s'engeguen i després disparen sense parar. Amaga't darrere una paret abans que comencin.",
    'tanks.note.hornet': "Aquí les vespes minen el camí fins a elles i disparen a una mina just quan hi passes a prop. Allunya't de totes les mines.",
    'tanks.cleared': 'Missió superada!',
    'tanks.bonus': 'Tanc extra!',
    'tanks.destroyed': 'Tanc destruït',
    'tanks.livesLeft': 'Vides restants: {n}',
    'tanks.gameOver': 'Fi de la partida',
    'tanks.victory': 'Totes les missions superades!',
    'tanks.victoryShort': 'Campanya superada!',
    'tanks.reached': 'Missió assolida',
    'tanks.destroyedCount': 'Tancs destruïts',
    'tanks.newRecord': 'Nou rècord!',
    'tanks.playAgain': 'Torna a jugar',
    'tanks.pads': 'Controls tàctils: a baix a l\'esquerra condueixes, a baix a la dreta apuntes i dispares',
    'tanks.mine': 'Posa una mina',
    'tanks.ammo': 'Projectils a punt: {shells} de {maxShells}. Mines a punt: {mines} de {maxMines}.',
    'tanks.type.brown': 'Marró',
    'tanks.type.ash': 'Gris',
    'tanks.type.marine': 'Turquesa',
    'tanks.type.yellow': 'Groc',
    'tanks.type.pink': 'Rosa',
    'tanks.type.green': 'Verd',
    'tanks.type.violet': 'Lila',
    'tanks.type.white': 'Blanc',
    'tanks.type.black': 'Negre',
    'tanks.type.red': 'Vermell',
    'tanks.type.olive': 'Oliva',
    'tanks.type.lime': 'Llima',
    'tanks.type.hornet': 'Vespa',
    'tanks.test': 'Prova',
    'tanks.testTitle': 'Camp de proves',
    'tanks.testIntro': "Quatre parets, tu a l'esquerra i els enemics que triïs a la dreta. Res d'aquí compta per al rècord.",
    'tanks.testEnemy': 'Enemic',
    'tanks.testCount': 'Quants',
    'tanks.testStart': 'Comença la prova',
    'tanks.testEnd': 'Acaba la prova',
    'tanks.testCleared': 'Prova superada!',
    'tanks.name.1': 'Primer contacte',
    'tanks.name.2': 'Foc creuat',
    'tanks.name.3': 'Patrulla',
    'tanks.name.4': 'La porta de caixes',
    'tanks.name.5': 'Camp de tir',
    'tanks.name.6': 'Ziga-zaga',
    'tanks.name.7': 'Carambola',
    'tanks.name.8': 'Entre forats',
    'tanks.name.9': 'El laberint',
    'tanks.name.10': 'Partida de mirall',
    'tanks.name.11': 'Búnquers',
    'tanks.name.12': 'Blanc fixat',
    'tanks.name.13': 'Fantasmes',
    'tanks.name.14': 'Caçador',
    'tanks.name.15': 'Artilleria',
    'tanks.name.16': 'La cruïlla',
    'tanks.name.17': 'La fortalesa',
    'tanks.name.18': 'Torn de nit',
    'tanks.name.19': 'Setge',
    'tanks.name.20': "L'última batalla",
    'tanks.brief.1': 'Una torreta darrere una paret. Fes-li la volta, o fes-hi rebotar un projectil.',
    'tanks.brief.2': "Tres torretes cobreixen el centre. Elimina-les d'una en una.",
    'tanks.brief.3': "Fan voltes al bloc gran. Espera'ls a una cantonada.",
    'tanks.brief.4': 'Les caixes ratllades aturen els projectils. Una mina les rebenta.',
    'tanks.brief.5': 'Els coets no reboten mai: mantén un pilar entre vosaltres.',
    'tanks.brief.6': 'Els passadissos van i tornen. Vigila les mines a terra.',
    'tanks.brief.7': 'Aquí els projectils reboten i giren les cantonades. Una paret no sempre et protegeix.',
    'tanks.brief.8': 'Els projectils passen per sobre dels forats. Els tancs creuen pel pont.',
    'tanks.brief.9': 'Cantonades cegues pertot arreu. Compte amb els teus propis rebots.',
    'tanks.brief.10': 'Dos tancs armats com tu, en una arena simètrica.',
    'tanks.brief.11': 'Dues torretes dins de búnquers. Rodeja-les.',
    'tanks.brief.12': "Pilars pertot arreu: posa'n un entre tu i cada míssil.",
    'tanks.brief.13': 'Racons de caixes pertot arreu, i alguna cosa amagada a dins.',
    'tanks.brief.14': "Un caçador ràpid. Fes servir els circuits per treure-te'l de sobre.",
    'tanks.brief.15': "Dos patis tancats. Neteja el terreny obert i després assalta'ls.",
    'tanks.brief.16': 'Quatre braços i cap protecció al mig. Creua de pressa.',
    'tanks.brief.17': 'Les portes són de caixes. Porta mines.',
    'tanks.brief.18': 'Parets curtes, ombres llargues i fantasmes entre elles.',
    'tanks.brief.19': "Morters darrere la línia, caçadors al davant. Obre't pas.",
    'tanks.brief.20': 'Tots els tipus de tanc alhora. Sort!',
  },
};

function detect() {
  const saved = store.load('lang', 1);
  if (LANGS.includes(saved)) return saved;
  const prefs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
  for (const l of prefs) {
    const code = String(l).toLowerCase().slice(0, 2);
    if (LANGS.includes(code)) return code;
  }
  // Spanish (and other Iberian) phones are most likely friends in Catalonia.
  return prefs.some((l) => /^(es|oc|gl|eu)\b/i.test(l)) ? 'ca' : 'en';
}

let current = detect();
document.documentElement.lang = current;

export function getLang() {
  return current;
}

export function setLang(lang) {
  if (!LANGS.includes(lang)) return;
  current = lang;
  store.save('lang', 1, lang);
  document.documentElement.lang = lang;
  localize();
}

export function t(key, params) {
  let s = STRINGS[current][key] ?? STRINGS.en[key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
  return s;
}

/** Text for a value that is either a plain string or an { en, ca } object. */
export function pick(value) {
  if (value && typeof value === 'object') return value[current] ?? value.en ?? '';
  return value ?? '';
}

/**
 * Fills [data-i18n] text and [data-i18n-label] aria-label/title under root.
 */
export function localize(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-label]')) {
    const label = t(el.dataset.i18nLabel);
    el.setAttribute('aria-label', label);
    el.setAttribute('title', label);
  }
}

export function formatNumber(n) {
  return new Intl.NumberFormat(current === 'ca' ? 'ca' : 'en').format(n);
}

/** A download size such as "115 KB" or "1.4 MB" (in Catalan "1,4 MB"). */
export function formatBytes(bytes) {
  const locale = current === 'ca' ? 'ca' : 'en';
  if (bytes < 1024 * 1024) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.max(1, bytes / 1024))} KB`;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} MB`;
}

/** 0.42 -> "42%" (Catalan: "42 %"). */
export function formatPercent(fraction) {
  return new Intl.NumberFormat(current === 'ca' ? 'ca' : 'en', { style: 'percent' }).format(fraction);
}

/** ms -> "m:ss" or "h:mm:ss". */
export function formatTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${String(m).padStart(2, '0')}:${ss}`;
}
