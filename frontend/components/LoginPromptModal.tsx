import React from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, StyleSheet } from 'react-native';
import { LogIn, X } from 'lucide-react-native';
import { router } from 'expo-router';
import { C } from '@/constants/theme';

interface LoginPromptModalProps {
  visible: boolean;
  onClose: () => void;
  message?: string;
}

export default function LoginPromptModal({ visible, onClose, message }: LoginPromptModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={s.card} onPress={() => {}}>
          <TouchableOpacity onPress={onClose} style={s.closeBtn}>
            <X size={18} color={C.textFaint} strokeWidth={2} />
          </TouchableOpacity>

          <View style={s.iconWrap}>
            <LogIn size={28} color={C.brand} strokeWidth={2} />
          </View>

          <Text style={s.title}>Login Required</Text>
          <Text style={s.subtitle}>
            {message ?? 'Please log in to like this trek.'}
          </Text>

          <TouchableOpacity
            onPress={() => { onClose(); router.push('/login'); }}
            style={s.loginBtn}>
            <Text style={s.loginText}>Log In</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={onClose} style={s.cancelBtn}>
            <Text style={s.cancelText}>Maybe later</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  card: {
    width: '100%',
    backgroundColor: C.surface,
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
  },
  closeBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    padding: 4,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(15,82,56,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    marginTop: 8,
  },
  title: {
    color: C.white,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    color: C.textFaint,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  loginBtn: {
    width: '100%',
    backgroundColor: C.brand,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  loginText: { color: C.white, fontSize: 15, fontWeight: '700' },
  cancelBtn: { paddingVertical: 10 },
  cancelText: { color: C.textFaint, fontSize: 14 },
});
