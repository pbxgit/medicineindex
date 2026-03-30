/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Component, useState, useEffect, useMemo } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  signOut, 
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  onSnapshot, 
  updateDoc,
  arrayUnion,
  arrayRemove,
  getDocFromServer
} from 'firebase/firestore';
import { auth, db, googleProvider } from './firebase';
import { topics, Topic } from './data';
import { 
  CheckCircle2, 
  Circle, 
  LogOut, 
  LogIn, 
  BookOpen, 
  Trophy, 
  BarChart3,
  Loader2,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- Utilities ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Error Boundary ---
class ErrorBoundary extends (Component as any) {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    const state = (this as any).state;
    if (state.hasError) {
      let errorMessage = "Something went wrong.";
      try {
        const parsed = JSON.parse(state.error.message);
        if (parsed.error) errorMessage = parsed.error;
      } catch (e) {
        errorMessage = state.error.message || errorMessage;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
          <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Application Error</h2>
            <p className="text-gray-600 mb-6">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="bg-blue-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return (this as any).props.children;
  }
}

// --- Main App Component ---
function MedicineTracker() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [completedTopicIds, setCompletedTopicIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  // Test connection
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    }
    testConnection();
  }, []);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setIsAuthReady(true);
      
      if (firebaseUser) {
        // Sync user profile
        const userRef = doc(db, 'users', firebaseUser.uid);
        try {
          await setDoc(userRef, {
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName,
            photoURL: firebaseUser.photoURL,
            lastUpdated: new Date().toISOString()
          }, { merge: true });
        } catch (error) {
          console.error("Error updating user profile:", error);
        }
      } else {
        setCompletedTopicIds([]);
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // Progress Listener
  useEffect(() => {
    if (!isAuthReady || !user) return;

    const progressRef = doc(db, 'users', user.uid, 'progress', 'current');
    
    const unsubscribe = onSnapshot(progressRef, (snapshot) => {
      if (snapshot.exists()) {
        setCompletedTopicIds(snapshot.data().completedTopicIds || []);
      } else {
        setCompletedTopicIds([]);
      }
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}/progress/current`);
    });

    return () => unsubscribe();
  }, [isAuthReady, user]);

  const handleToggleTopic = async (sno: number) => {
    if (!user) return;

    const progressRef = doc(db, 'users', user.uid, 'progress', 'current');
    const isCompleted = completedTopicIds.includes(sno);

    try {
      const docSnap = await getDoc(progressRef);
      if (!docSnap.exists()) {
        await setDoc(progressRef, {
          completedTopicIds: [sno],
          updatedAt: new Date().toISOString()
        });
      } else {
        await updateDoc(progressRef, {
          completedTopicIds: isCompleted ? arrayRemove(sno) : arrayUnion(sno),
          updatedAt: new Date().toISOString()
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}/progress/current`);
    }
  };

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const stats = useMemo(() => {
    const total = topics.length;
    const completed = completedTopicIds.length;
    const percentage = total > 0 ? ((completed / total) * 100).toFixed(1) : "0.0";
    return { total, completed, percentage };
  }, [completedTopicIds]);

  if (!isAuthReady || (user && loading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f9f9f9] p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-10 rounded-3xl shadow-2xl max-w-lg w-full text-center border border-gray-100"
        >
          <div className="bg-blue-50 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <BookOpen className="w-10 h-10 text-blue-600" />
          </div>
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Medicine Study Tracker</h1>
          <p className="text-gray-600 mb-10 text-lg">
            Track your progress through 141 essential internal medicine topics. 
            Sign in to save your progress across devices.
          </p>
          <button 
            onClick={handleLogin}
            className="w-full flex items-center justify-center gap-3 bg-white border-2 border-gray-200 text-gray-700 px-8 py-4 rounded-2xl font-bold text-lg hover:bg-gray-50 hover:border-blue-200 transition-all shadow-sm"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-6 h-6" alt="Google" />
            Sign in with Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f9f9f9] pb-20">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-lg">
              <BookOpen className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-[#0b5394] hidden sm:block">Medicine Study Tracker</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-semibold text-gray-900">{user.displayName}</p>
              <p className="text-xs text-gray-500">{user.email}</p>
            </div>
            {user.photoURL && (
              <img src={user.photoURL} alt="Profile" className="w-10 h-10 rounded-full border-2 border-blue-100" />
            )}
            <button 
              onClick={handleLogout}
              className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              title="Logout"
            >
              <LogOut className="w-6 h-6" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          <motion.div 
            whileHover={{ y: -5 }}
            className="bg-white p-6 rounded-2xl shadow-sm border border-blue-50 flex items-center gap-5"
          >
            <div className="bg-blue-50 p-4 rounded-xl">
              <BarChart3 className="w-8 h-8 text-blue-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-[#0b5394] uppercase tracking-wider">Total Topics</p>
              <p className="text-3xl font-black text-gray-900">{stats.total}</p>
            </div>
          </motion.div>

          <motion.div 
            whileHover={{ y: -5 }}
            className="bg-white p-6 rounded-2xl shadow-sm border border-green-50 flex items-center gap-5"
          >
            <div className="bg-green-50 p-4 rounded-xl">
              <CheckCircle2 className="w-8 h-8 text-green-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-green-700 uppercase tracking-wider">Completed</p>
              <p className="text-3xl font-black text-gray-900">{stats.completed}</p>
            </div>
          </motion.div>

          <motion.div 
            whileHover={{ y: -5 }}
            className="bg-white p-6 rounded-2xl shadow-sm border border-blue-50 flex items-center gap-5"
          >
            <div className="bg-blue-50 p-4 rounded-xl">
              <Trophy className="w-8 h-8 text-blue-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-[#0b5394] uppercase tracking-wider">Progress</p>
              <p className="text-3xl font-black text-blue-600">{stats.percentage}%</p>
            </div>
          </motion.div>
        </div>

        {/* Table Section */}
        <div className="bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-100">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#2d5a4c] text-white">
                  <th className="px-6 py-5 font-bold text-sm uppercase tracking-wider w-20 text-center">S.No.</th>
                  <th className="px-6 py-5 font-bold text-sm uppercase tracking-wider w-40">System</th>
                  <th className="px-6 py-5 font-bold text-sm uppercase tracking-wider">Topic Title</th>
                  <th className="px-6 py-5 font-bold text-sm uppercase tracking-wider w-32">Duration</th>
                  <th className="px-6 py-5 font-bold text-sm uppercase tracking-wider w-32 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {topics.map((topic) => {
                  const isCompleted = completedTopicIds.includes(topic.sno);
                  return (
                    <motion.tr 
                      key={topic.sno}
                      initial={false}
                      animate={{ backgroundColor: isCompleted ? '#f0fdf4' : '#ffffff' }}
                      className="hover:bg-gray-50 transition-colors group"
                    >
                      <td className="px-6 py-4 text-center font-mono text-gray-400">{topic.sno}</td>
                      <td className="px-6 py-4 font-bold text-gray-700">{topic.system}</td>
                      <td className={cn(
                        "px-6 py-4 text-gray-900 font-medium transition-all",
                        isCompleted && "text-gray-400 line-through"
                      )}>
                        {topic.title}
                      </td>
                      <td className="px-6 py-4 text-gray-500 font-mono text-sm">{topic.duration}</td>
                      <td className="px-6 py-4 text-center">
                        <button 
                          onClick={() => handleToggleTopic(topic.sno)}
                          className={cn(
                            "p-2 rounded-full transition-all transform active:scale-90",
                            isCompleted 
                              ? "text-green-600 bg-green-100 hover:bg-green-200" 
                              : "text-gray-300 hover:text-blue-500 hover:bg-blue-50"
                          )}
                        >
                          {isCompleted ? <CheckCircle2 className="w-6 h-6" /> : <Circle className="w-6 h-6" />}
                        </button>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <MedicineTracker />
    </ErrorBoundary>
  );
}

