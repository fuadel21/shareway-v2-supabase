import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';

const servers = {
    iceServers: [
        {
            urls: [
                'stun:stun1.l.google.com:19302',
                'stun:stun2.l.google.com:19302',
            ],
        },
    ],
    iceCandidatePoolSize: 10,
};

export const useWebRTC = (chatId, currentUserId, setCallSession) => {
    const pc = useRef(new RTCPeerConnection(servers));
    const localStreamRef = useRef(null);
    const remoteStreamRef = useRef(new MediaStream());
    const channelRef = useRef(null);

    const [localStream, setLocalStream] = useState(null);
    const [remoteStream, setRemoteStream] = useState(null);

    const setupStreams = async () => {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStreamRef.current = stream;
        stream.getTracks().forEach((track) => {
            pc.current.addTrack(track, stream);
        });
        setLocalStream(stream);

        pc.current.ontrack = (event) => {
            event.streams[0].getTracks().forEach((track) => {
                remoteStreamRef.current.addTrack(track);
            });
            setRemoteStream(remoteStreamRef.current);
        };
    };

    const startCall = async (otherUserId) => {
        await setupStreams();
        channelRef.current = supabase.channel(`webrtc-call-${chatId}`);

        pc.current.onicecandidate = (event) => {
            event.candidate && channelRef.current.send({ type: 'ice-candidate', candidate: event.candidate });
        };

        const offer = await pc.current.createOffer();
        await pc.current.setLocalDescription(offer);

        channelRef.current.send({ type: 'offer', offer, callerId: currentUserId, calleeId: otherUserId });
        channelRef.current.subscribe();
        setCallSession({ status: 'dialing' });
    };

    const answerCall = async (offer) => {
        await setupStreams();
        channelRef.current = supabase.channel(`webrtc-call-${chatId}`);

        pc.current.onicecandidate = (event) => {
            event.candidate && channelRef.current.send({ type: 'ice-candidate', candidate: event.candidate });
        };

        await pc.current.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.current.createAnswer();
        await pc.current.setLocalDescription(answer);

        channelRef.current.send({ type: 'answer', answer });
        channelRef.current.subscribe();
        setCallSession({ status: 'active' });
    };

    const endCall = useCallback(() => {
        localStreamRef.current?.getTracks().forEach((track) => track.stop());
        pc.current.close();
        pc.current = new RTCPeerConnection(servers);

        if (channelRef.current) {
            supabase.removeChannel(channelRef.current);
            channelRef.current = null;
        }

        setLocalStream(null);
        setRemoteStream(null);
        setCallSession(null);
    }, [setCallSession]);

    useEffect(() => {
        if (!chatId) return;

        const channel = supabase.channel(`webrtc-call-${chatId}`);
        channel.on('broadcast', { event: 'offer' }, ({ payload }) => {
            if (payload.calleeId === currentUserId) {
                setCallSession({ ...payload, status: 'incoming' });
            }
        });

        channel.on('broadcast', { event: 'answer' }, async ({ payload }) => {
            if (pc.current.signalingState !== 'stable') {
                await pc.current.setRemoteDescription(new RTCSessionDescription(payload.answer));
            }
        });

        channel.on('broadcast', { event: 'ice-candidate' }, ({ payload }) => {
            pc.current.addIceCandidate(new RTCIceCandidate(payload.candidate));
        });
        
        channel.subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [chatId, currentUserId, setCallSession]);

    return { startCall, endCall, answerCall, localStream, remoteStream };
};
