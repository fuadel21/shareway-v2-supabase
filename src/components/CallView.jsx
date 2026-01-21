import React, { useEffect, useRef, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Phone, PhoneOff, Mic, MicOff } from 'lucide-react';
import { cn } from '@/lib/utils';

const getInitials = (name) => {
    if (typeof name !== 'string' || !name.trim()) return '?';
    return name.split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase();
};

const CallTimer = ({ startTime }) => {
    const [duration, setDuration] = useState(0);

    useEffect(() => {
        if (!startTime) return;
        const interval = setInterval(() => {
            setDuration(Math.floor((Date.now() - startTime) / 1000));
        }, 1000);
        return () => clearInterval(interval);
    }, [startTime]);

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
        const secs = (seconds % 60).toString().padStart(2, '0');
        return `${mins}:${secs}`;
    };

    return <p className="text-lg text-white/80">{formatTime(duration)}</p>;
};

const CallView = ({ callSession, otherUser, currentUser, onAccept, onHangup, localStream, remoteStream }) => {
    const remoteAudioRef = useRef(null);
    const localAudioRef = useRef(null);
    const [isMuted, setIsMuted] = useState(false);

    useEffect(() => {
        if (remoteStream && remoteAudioRef.current) {
            remoteAudioRef.current.srcObject = remoteStream;
        }
        if (localStream && localAudioRef.current) {
            localAudioRef.current.srcObject = localStream;
        }
    }, [remoteStream, localStream]);

    const toggleMute = () => {
        if (localStream) {
            localStream.getAudioTracks().forEach(track => {
                track.enabled = !track.enabled;
            });
            setIsMuted(prev => !prev);
        }
    };

    const isIncoming = callSession.callerId !== currentUser.uid && callSession.status === 'dialing';
    const isDialing = callSession.callerId === currentUser.uid && callSession.status === 'dialing';
    const isActive = callSession.status === 'active';

    const renderContent = () => {
        if (isIncoming) {
            return (
                <div className="text-center">
                    <p className="text-lg text-white/80 mb-2">Llamada entrante de</p>
                    <h2 className="text-4xl font-bold text-white mb-8">{otherUser?.displayName}</h2>
                    <div className="flex justify-center gap-x-6">
                        <Button onClick={onHangup} variant="destructive" size="lg" className="rounded-full w-20 h-20"><PhoneOff size={32} /></Button>
                        <Button onClick={onAccept} className="rounded-full w-20 h-20 bg-green-500 hover:bg-green-600"><Phone size={32} /></Button>
                    </div>
                </div>
            );
        }

        if (isDialing) {
            return <h2 className="text-4xl font-bold text-white animate-pulse">Llamando a {otherUser?.displayName}...</h2>;
        }

        if (isActive) {
            return (
                <div className="flex flex-col items-center">
                    <h2 className="text-4xl font-bold text-white mb-4">{otherUser?.displayName}</h2>
                    <CallTimer startTime={callSession.answerTime?.toMillis() || Date.now()} />
                </div>
            );
        }

        return null;
    };

    return (
        <div className="absolute inset-0 bg-gray-900/90 backdrop-blur-md z-50 flex flex-col items-center justify-between p-8">
            {/* Elementos de audio (ocultos) */}
            <audio ref={localAudioRef} autoPlay muted playsInline />
            <audio ref={remoteAudioRef} autoPlay playsInline />

            <div className="flex flex-col items-center pt-20">
                <Avatar className="w-40 h-40 mb-6 border-4 border-white/50">
                    <AvatarImage src={otherUser?.photoURL} />
                    <AvatarFallback className="text-6xl">{getInitials(otherUser?.displayName)}</AvatarFallback>
                </Avatar>
                {renderContent()}
            </div>

            {(isDialing || isActive) && (
                <div className="flex items-center gap-x-6">
                    {isActive && (
                        <Button onClick={toggleMute} variant="secondary" size="lg" className={cn("rounded-full w-20 h-20", isMuted && "bg-yellow-500 hover:bg-yellow-600")}>
                           {isMuted ? <MicOff size={32}/> : <Mic size={32}/>}
                        </Button>
                    )}
                    <Button onClick={onHangup} variant="destructive" size="lg" className="rounded-full w-20 h-20"><PhoneOff size={32} /></Button>
                </div>
            )}
        </div>
    );
};

export default CallView;
