import React, { useState, useRef, useEffect } from 'react';
import { BookOpen, Download, ArrowUp, ArrowDown, User, LogIn, LogOut, Loader2, Calendar, ChevronLeft, ChevronRight, Copy } from 'lucide-react';
import html2pdf from 'html2pdf.js';
import { auth, googleProvider, db } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';

/**
 * 連絡帳アプリ (管理者・閲覧者 分離版 + 前日コピー)
 *
 * * 変更点:
 * - データ保存先を `class_notes/{date}` (共有) に変更
 * - 管理者 (d.a0807derude@gmail.com) のみ編集パネルを表示
 * - 閲覧者はプレビューと日付選択のみ可能
 * - 日付選択をヘッダー/メインエリアに移動
 * - 前日の内容をコピーする機能を追加
 */

// ----------------------------------------------------------------------
// Constants & Types
// ----------------------------------------------------------------------

const GRID_ROWS = 12;
const TEXT_MAX_LENGTH = GRID_ROWS - 1;

// 管理者のメールアドレス (これ以外は閲覧者扱い)
const ADMIN_EMAIL = "d.a0807derude@gmail.com";

// デフォルトの列データ構造
const DEFAULT_COLUMNS = [
  { id: 1, type: 'handout', text: "" },
  { id: 2, type: 'homework', text: "" },
  { id: 3, type: 'normal', text: "" },
  { id: 4, type: 'contact', text: "" },
  { id: 5, type: 'belongings', text: "" },
  { id: 6, type: 'empty', text: "" },
  { id: 7, type: 'empty', text: "" },
  { id: 8, type: 'empty', text: "" },
];

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

// ----------------------------------------------------------------------
// Helper Functions
// ----------------------------------------------------------------------

const getTodayString = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatDateDisplay = (dateStr) => {
  if (!dateStr) return { date: '', weekday: '' };
  const d = new Date(dateStr);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const week = WEEKDAYS[d.getDay()];
  return {
    date: `${month}月${day}日`,
    weekday: week
  };
};

const parseTextToChars = (text) => {
  if (!text) return [];
  const chars = [];
  const regex = /(\d{2})|([\s\S])/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) {
      chars.push({ char: match[1], isTateChuYoko: true });
    } else {
      chars.push({ char: match[2], isTateChuYoko: false });
    }
  }
  return chars;
};

// ----------------------------------------------------------------------
// Sub Components
// ----------------------------------------------------------------------

const CircleMark = ({ char, colorClass }) => (
  <div className={`w-[85%] h-[85%] rounded-full border-[1.5px] ${colorClass} flex items-center justify-center shrink-0`}>
    <span className={`text-[0.8em] font-bold leading-none ${colorClass.split(' ')[0]}`} style={{ writingMode: 'horizontal-tb' }}>
      {char}
    </span>
  </div>
);

const GridCell = ({ charData, isHeader, isLastRow }) => {
  // 横線（border-b）を削除し、縦線（border-r）のみにする
  const borderStyle = '';
  const bgStyle = isHeader ? 'bg-slate-50' : '';
  let content = null;

  if (charData) {
    const { char, isTateChuYoko, isMark, markType } = charData;
    if (isMark) {
      if (markType === 'homework') content = <CircleMark char="し" colorClass="text-indigo-600 border-indigo-600" />;
      else if (markType === 'contact') content = <CircleMark char="れ" colorClass="text-emerald-600 border-emerald-600" />;
      else if (markType === 'belongings') content = <CircleMark char="も" colorClass="text-rose-600 border-rose-600" />;
      else if (markType === 'handout') content = <CircleMark char="手" colorClass="text-amber-600 border-amber-600" />;
    } else {
      const isAlphanumeric = !isTateChuYoko && /[0-9a-zA-Z]/.test(char);
      content = (
        <span
          className={`leading-none select-none text-slate-700 
            ${isTateChuYoko
              ? 'font-sans text-[0.85em] font-medium w-full text-center tracking-tighter'
              : 'font-serif text-[1.1em]'
            }
          `}
          style={{ writingMode: isTateChuYoko ? 'horizontal-tb' : 'vertical-rl', textOrientation: isAlphanumeric ? 'upright' : undefined }}
        >
          {char}
        </span>
      );
    }
  }
  return (
    <div className={`w-full h-full border-r border-slate-300 ${borderStyle} ${bgStyle} flex items-center justify-center relative overflow-hidden`}>
      {content}
    </div>
  );
};

const NotebookColumn = ({ data }) => {
  const firstCellData = { isMark: true, markType: data.type };
  const textChars = parseTextToChars(data.text);
  const cells = Array(GRID_ROWS).fill(null).map((_, i) => {
    if (i === 0) return firstCellData;
    return textChars[i - 1] || null;
  });
  return (
    <div className="h-full border-l border-slate-400 box-border flex-1 min-w-[30px]">
      <div className="grid h-full w-full" style={{ gridTemplateRows: `repeat(${GRID_ROWS}, 1fr)` }}>
        {cells.map((charData, i) => (
          <GridCell key={i} charData={charData} isHeader={false} isLastRow={i === GRID_ROWS - 1} />
        ))}
      </div>
    </div>
  );
};

const DateColumn = ({ dateStr }) => {
  const { date, weekday } = formatDateDisplay(dateStr);
  const dateChars = parseTextToChars(date);
  const weekChars = parseTextToChars(weekday);
  const cellsRaw = [];
  for (let i = 0; i < 2; i++) cellsRaw.push(null);
  dateChars.forEach(c => cellsRaw.push(c));
  cellsRaw.push(null);
  weekChars.forEach(c => cellsRaw.push(c));
  const cells = Array(GRID_ROWS).fill(null).map((_, i) => cellsRaw[i] || null);

  return (
    <div className="h-full border-l-2 border-slate-500 box-border flex-1 min-w-[30px] bg-slate-50/50">
      <div className="grid h-full w-full" style={{ gridTemplateRows: `repeat(${GRID_ROWS}, 1fr)` }}>
        {cells.map((char, i) => (
          <GridCell key={i} charData={char} isHeader={true} isLastRow={i === GRID_ROWS - 1} />
        ))}
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------
// Main Application
// ----------------------------------------------------------------------

export default function RenrakuchoApp() {
  // State
  const [user, setUser] = useState(null); // Firebase User
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true); // Auth Loading
  const [dataLoading, setDataLoading] = useState(false); // Data Fetching

  const [currentDate, setCurrentDate] = useState(getTodayString());
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  // activeTabは管理者のみ使用 (edit/preview切り替え)。閲覧者は常にpreview
  const [activeTab, setActiveTab] = useState('edit');
  const notebookRef = useRef(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u && u.email === ADMIN_EMAIL) {
        setIsAdmin(true);
      } else {
        setIsAdmin(false);
        setActiveTab('preview'); // 管理者以外は強制的にプレビュー
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Data Fetching (Shared Collection: class_notes)
  useEffect(() => {
    // ログインしていなくても見れるようにする (セキュリティルールで許可前提)
    // ただし、データ読み込みは日付が変わったタイミングなどで実行

    const loadData = async () => {
      setDataLoading(true);
      try {
        // 共有コレクション 'class_notes' から取得
        const docRef = doc(db, "class_notes", currentDate);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          setColumns(docSnap.data().columns);
        } else {
          setColumns(DEFAULT_COLUMNS);
        }
      } catch (error) {
        console.error("Error loading document: ", error);
        // 権限エラーなどの場合はアラートを出してもいいが、
        // 閲覧者がアクセスした瞬間にエラーが出るのを防ぐためconsoleのみにするか、
        // "読み込めませんでした"を表示する
      } finally {
        setDataLoading(false);
      }
    };

    loadData();
  }, [currentDate]); // ユーザー依存を削除（誰でも同じ日付ならデータは見れる）

  // Save Logic (Admin Only)
  const saveData = async (newColumns) => {
    if (!isAdmin || !user) return;
    try {
      const docRef = doc(db, "class_notes", currentDate);
      await setDoc(docRef, {
        columns: newColumns,
        date: currentDate,
        updatedBy: user.email,
        updatedAt: new Date()
      });
    } catch (error) {
      console.error("Error writing document: ", error);
      alert("保存に失敗しました。権限を確認してください。");
    }
  };

  const handleCopyPreviousDay = async () => {
    if (!isAdmin || !confirm("現在表示しているページの内容を、前日のデータで上書きしますか？\n（現在の入力内容は消えてしまいます）")) return;

    // 前日の日付を計算
    const d = new Date(currentDate);
    d.setDate(d.getDate() - 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const previousDate = `${year}-${month}-${day}`;

    try {
      const docRef = doc(db, "class_notes", previousDate);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const prevData = docSnap.data().columns;
        setColumns(prevData);
        saveData(prevData); // 即保存
        alert(`${previousDate} のデータをコピーしました！`);
      } else {
        alert(`${previousDate} のデータが見つかりませんでした。`);
      }
    } catch (error) {
      console.error("Error copying previous day: ", error);
      alert("前日のデータの取得に失敗しました。");
    }
  };


  // Handlers
  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      // ログアウトしてもデータは残る（閲覧者として見るため）
      setIsAdmin(false);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  const handleTextChange = (id, newText) => {
    const newColumns = columns.map(col =>
      col.id === id ? { ...col, text: newText } : col
    );
    setColumns(newColumns);
    saveData(newColumns);
  };

  const handleTypeChange = (id, newType) => {
    const newColumns = columns.map(col =>
      col.id === id ? { ...col, type: newType } : col
    );
    setColumns(newColumns);
    saveData(newColumns);
  };

  const moveRow = (index, direction) => {
    const newColumns = [...columns];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= newColumns.length) return;
    [newColumns[index], newColumns[targetIndex]] = [newColumns[targetIndex], newColumns[index]];
    setColumns(newColumns);
    saveData(newColumns);
  };

  const handleDownloadPDF = () => {
    const element = notebookRef.current;
    if (!element) return;
    const opt = {
      margin: 0,
      filename: `renrakucho-${currentDate}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    html2pdf().set(opt).from(element).save();
  };

  const changeDate = (days) => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + days);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    setCurrentDate(`${year}-${month}-${day}`);
  };

  const markButtons = [
    { type: 'normal', label: 'なし', char: '-', color: 'bg-slate-100 text-slate-500 border-slate-300' },
    { type: 'handout', label: '手紙', char: '手', color: 'bg-amber-100 text-amber-700 border-amber-300' },
    { type: 'homework', label: '宿題', char: 'し', color: 'bg-indigo-100 text-indigo-700 border-indigo-300' },
    { type: 'contact', label: '連絡', char: 'れ', color: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
    { type: 'belongings', label: '持物', char: 'も', color: 'bg-rose-100 text-rose-700 border-rose-300' },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-100 text-slate-400">
        <Loader2 className="animate-spin mr-2" /> Loading...
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-neutral-100 font-sans text-slate-800 flex flex-col md:flex-row overflow-hidden">

      {/* ------------------------------------------------------------------
          [共通] ヘッダー (閲覧者も日付変更できるようにする)
         ------------------------------------------------------------------ */}
      <div className="absolute top-0 left-0 right-0 h-14 bg-indigo-600 shadow-md z-30 flex items-center justify-between px-4 text-white">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold flex items-center gap-2">
            <BookOpen size={20} />
            <span className="hidden sm:inline">デジタル</span>連絡帳
          </h1>

          {/* 日付選択 (Header内) */}
          <div className="flex items-center bg-indigo-700 rounded-md overflow-hidden border border-indigo-500/30">
            <button onClick={() => changeDate(-1)} className="p-1.5 hover:bg-indigo-500 transition"><ChevronLeft size={16} /></button>
            <div className="relative">
              <input
                type="date"
                value={currentDate}
                onChange={(e) => setCurrentDate(e.target.value)}
                className="bg-transparent text-white border-none outline-none text-sm font-bold px-2 w-32 text-center [&::-webkit-calendar-picker-indicator]:invert"
              />
            </div>
            <button onClick={() => changeDate(1)} className="p-1.5 hover:bg-indigo-500 transition"><ChevronRight size={16} /></button>
          </div>
          {dataLoading && <Loader2 className="animate-spin text-white/70" size={16} />}
        </div>

        <div className="flex items-center gap-2">
          {isAdmin ? (
            <div className="flex items-center gap-2">
              <div className="hidden sm:block text-xs text-indigo-200">管理者モード</div>
              <button onClick={handleLogout} className="bg-white/20 hover:bg-white/30 p-2 rounded-full transition" title="ログアウト">
                <LogOut size={18} />
              </button>
            </div>
          ) : (
            // 閲覧者にはログインボタンを控えめに表示（管理者用）
            <button onClick={handleLogin} className="text-indigo-200 text-xs hover:text-white flex items-center gap-1 opacity-70 hover:opacity-100 transition">
              <LogIn size={14} /> 管理者
            </button>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------------
          左側: 入力パネル (Admin Only)
         ------------------------------------------------------------------ */}
      {isAdmin && (
        <div className={`
            pt-14 w-full md:w-96 bg-white shadow-xl z-20 flex flex-col border-r border-slate-200 h-full
            ${activeTab === 'preview' ? 'hidden md:flex' : 'flex'}
        `}>
          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-20 md:pb-4 relative">

            {/* Copy Previous Day Button */}
            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100 text-center">
              <button
                onClick={handleCopyPreviousDay}
                className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center justify-center gap-1 mx-auto py-1 px-3 border border-indigo-200 rounded hover:bg-indigo-50 transition"
              >
                <Copy size={12} /> 前日の内容をコピー
              </button>
            </div>

            {/* Form Inputs */}
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">内容入力 (右の列から)</h2>
                <span className="text-xs text-slate-400">最大{TEXT_MAX_LENGTH}文字</span>
              </div>

              {columns.map((col, index) => (
                <div key={col.id} className="group bg-white border border-slate-200 rounded-lg p-3 hover:border-indigo-300 transition-colors shadow-sm transition-all">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                        {index === 0 ? '見出し' : `${index + 1}列目`}
                      </span>

                      <div className="flex items-center border border-slate-200 rounded overflow-hidden">
                        <button
                          onClick={() => moveRow(index, -1)}
                          disabled={index === 0}
                          className="px-1.5 py-0.5 hover:bg-slate-100 active:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed border-r border-slate-200"
                        >
                          <ArrowUp size={14} className="text-slate-500" />
                        </button>
                        <button
                          onClick={() => moveRow(index, 1)}
                          disabled={index === columns.length - 1}
                          className="px-1.5 py-0.5 hover:bg-slate-100 active:bg-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <ArrowDown size={14} className="text-slate-500" />
                        </button>
                      </div>
                    </div>

                    <div className="flex gap-1 bg-slate-50 p-1 rounded-full border border-slate-100">
                      {markButtons.map((btn) => {
                        const isActive = col.type === btn.type;
                        const activeClass = isActive
                          ? 'bg-white shadow ring-1 ring-indigo-200 scale-100 z-10'
                          : 'text-slate-400 hover:text-slate-600 hover:bg-slate-200 scale-90';

                        return (
                          <button
                            key={btn.type}
                            onClick={() => handleTypeChange(col.id, btn.type)}
                            className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${activeClass}`}
                            title={btn.label}
                          >
                            {btn.type === 'normal' ? <span className="text-lg leading-none">-</span> : (
                              <span className={`flex items-center justify-center w-5 h-5 rounded-full border 
                                ${btn.type === 'handout' ? 'border-amber-500 text-amber-600' : ''}
                                ${btn.type === 'homework' ? 'border-indigo-500 text-indigo-600' : ''}
                                ${btn.type === 'contact' ? 'border-emerald-500 text-emerald-600' : ''}
                                ${btn.type === 'belongings' ? 'border-rose-500 text-rose-600' : ''}
                                `}>{btn.char}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="relative">
                    <input
                      type="text"
                      value={col.text}
                      onChange={(e) => handleTextChange(col.id, e.target.value)}
                      maxLength={TEXT_MAX_LENGTH}
                      className="w-full px-3 py-2 pr-10 border-b border-slate-200 bg-transparent focus:border-indigo-500 outline-none text-slate-700 placeholder-slate-300 transition-colors"
                      placeholder="入力..."
                    />
                    <div className={`absolute right-0 top-1/2 -translate-y-1/2 text-xs font-mono 
                        ${col.text.length > TEXT_MAX_LENGTH ? 'text-red-500 font-bold' : 'text-slate-300'}
                    `}>
                      {col.text.length}/{TEXT_MAX_LENGTH}
                    </div>
                  </div>
                </div>
              ))}
            </section>

            {/* Viewers don't need PDF download, but Admin might want it */}
            <div className="pt-4 pb-8">
              <button
                onClick={handleDownloadPDF}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-lg shadow-indigo-200 flex items-center justify-center gap-2 transition-all active:scale-95"
              >
                <Download size={18} />
                <span>PDFでダウンロード</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------
          右側 (Viewerにはメイン): プレビューエリア
         ------------------------------------------------------------------ */}
      <div className={`
        pt-14 flex-1 bg-neutral-200 overflow-hidden relative flex-col h-full
        ${isAdmin && activeTab === 'edit' ? 'hidden md:flex' : 'flex'}
      `}>
        {/* Admin Mobile Toggle Header (Not needed if Header is global, but maybe useful for "Edit" button?) */}
        {isAdmin && (
          <div className="md:hidden p-2 bg-white/50 backdrop-blur absolute top-16 left-2 right-2 rounded-lg z-10 flex justify-center">
            <span className="text-xs text-slate-500">プレビューモード中 (PC推奨)</span>
            <button onClick={() => setActiveTab('edit')} className="ml-4 text-xs font-bold text-indigo-600 border border-indigo-600 px-2 py-0.5 rounded">編集に戻る</button>
          </div>
        )}

        <div className="flex-1 overflow-auto bg-neutral-200 relative flex flex-col">
          {/* Viewing status for non-admins */}
          {!isAdmin && (
            <div className="text-center py-2 text-slate-500 text-sm">
              {/* 閲覧者向けメッセージ */}
            </div>
          )}

          <div className="min-h-full p-4 flex items-center justify-center">

            <div ref={notebookRef} className="bg-white shadow-xl h-[85vh] w-auto aspect-[3/4] relative overflow-hidden flex flex-col rounded-sm border border-slate-300 shrink-0">

              <div className="h-[8%] border-b border-slate-300 w-full bg-slate-50/50 flex items-end justify-between px-4 pb-2 shrink-0">
                <div className="text-[10px] text-slate-400">No. ______</div>
                <div className="text-[10px] text-slate-400">Date: {currentDate}</div>
              </div>

              <div className="flex-1 flex flex-row-reverse p-4 md:p-6 justify-center overflow-hidden">
                <DateColumn dateStr={currentDate} />
                {columns.map((col) => (
                  <NotebookColumn key={col.id} data={col} />
                ))}
              </div>

              <div className="h-[6%] border-t border-slate-300 w-full bg-slate-50/50 flex items-center justify-center shrink-0">
                <span className="text-xs text-slate-300 tracking-widest">RENRAKU-CHO</span>
              </div>

              <div className="absolute inset-0 pointer-events-none bg-gradient-to-r from-slate-900/5 via-transparent to-slate-900/5 mix-blend-multiply"></div>

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
