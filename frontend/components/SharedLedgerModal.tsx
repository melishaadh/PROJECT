import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { X, Wallet, Trash2, Check } from 'lucide-react-native';
import Avatar from '@/components/Avatar';
import {
  ChatRoom,
  LedgerEntry,
  LedgerSummaryRow,
  getRoomLedger,
  addLedgerEntry,
  deleteLedgerEntry,
} from '@/lib/chatService';
import { C } from '@/constants/theme';

/** "5m ago" / "3h ago" / "Aug 4" for an entry's timestamp. */
function formatWhen(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function formatAmount(n: number): string {
  return `Rs. ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

interface SharedLedgerModalProps {
  visible: boolean;
  onClose: () => void;
  room: ChatRoom;
  currentUserId: string | null;
}

/**
 * A group's shared expense ledger — who paid for what on the trip. Opened
 * from the thread's journal button, in place of the photo-upload sheet that
 * used to live there (removed for the same reason it's absent here: this
 * project has no object storage configured, so an in-document image upload
 * hit real, unpredictable size limits — a ledger has no such constraint).
 */
export default function SharedLedgerModal({ visible, onClose, room, currentUserId }: SharedLedgerModalProps) {
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [summary, setSummary] = useState<LedgerSummaryRow[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [payerId, setPayerId] = useState<string | null>(null);
  const [remark, setRemark] = useState('');
  const [amountText, setAmountText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!visible) return;
    setPayerId(prev => prev ?? currentUserId ?? room.members[0]?.id ?? null);
    let cancelled = false;
    setLoading(true);
    getRoomLedger(room.id).then(view => {
      if (cancelled) return;
      setEntries(view.entries);
      setSummary(view.summary);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [visible, room.id, currentUserId, room.members]);

  const canSubmit = useMemo(() => {
    const amount = Number(amountText);
    return !!payerId && remark.trim().length > 0 && Number.isFinite(amount) && amount > 0;
  }, [payerId, remark, amountText]);

  const handleAdd = async () => {
    if (!canSubmit || !payerId || submitting) return;
    const amount = Number(amountText);
    setSubmitting(true);
    setFormError('');
    const { ok, error } = await addLedgerEntry(room.id, payerId, amount, remark.trim());
    setSubmitting(false);
    if (!ok) {
      setFormError(error ?? 'Could not add that expense.');
      return;
    }
    setRemark('');
    setAmountText('');
    const view = await getRoomLedger(room.id);
    setEntries(view.entries);
    setSummary(view.summary);
  };

  const handleDelete = (entry: LedgerEntry) => {
    Alert.alert('Remove this entry?', `"${entry.remark}" — ${formatAmount(entry.amount)}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setDeletingId(entry.id);
          const { ok, error } = await deleteLedgerEntry(room.id, entry.id);
          setDeletingId(null);
          if (ok) {
            const view = await getRoomLedger(room.id);
            setEntries(view.entries);
            setSummary(view.summary);
          } else {
            Alert.alert('Could not remove entry', error ?? 'Please try again.');
          }
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={s.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={s.overlayFill} onPress={onClose}>
          <Pressable style={s.sheet} onPress={() => {}}>
            <View style={s.handle} />
            <View style={s.header}>
              <View style={{ flex: 1 }}>
                <Text style={s.title}>Shared Ledger</Text>
                <Text style={s.subtitle} numberOfLines={1}>{room.roomName}</Text>
              </View>
              <TouchableOpacity
                onPress={onClose}
                hitSlop={8}
                style={s.closeBtn}
                accessibilityRole="button"
                accessibilityLabel="Close shared ledger">
                <X size={18} color={C.textSub} strokeWidth={2} />
              </TouchableOpacity>
            </View>

            {loading ? (
              <View style={s.loadingBox}>
                <ActivityIndicator size="large" color={C.brand} />
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {summary.length > 0 && (
                  <>
                    <Text style={s.sectionLabel}>Totals</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.summaryRow}>
                      {summary.map(row => (
                        <View key={row.member.id} style={s.summaryChip}>
                          <Avatar uri={row.member.profilePicture} initials={row.member.name} size={30} />
                          <Text style={s.summaryName} numberOfLines={1}>{row.member.name || 'Trekker'}</Text>
                          <Text style={s.summaryAmount}>{formatAmount(row.total)}</Text>
                        </View>
                      ))}
                    </ScrollView>
                  </>
                )}

                <Text style={s.sectionLabel}>Expenses</Text>
                {entries.length === 0 ? (
                  <View style={s.emptyBox}>
                    <Wallet size={22} color={C.textFaint} strokeWidth={2} />
                    <Text style={s.emptyText}>No expenses logged yet.</Text>
                  </View>
                ) : (
                  entries.map(entry => (
                    <View key={entry.id} style={s.entryRow}>
                      <Avatar uri={entry.payer.profilePicture} initials={entry.payer.name} size={34} />
                      <View style={s.entryInfo}>
                        <Text style={s.entryRemark} numberOfLines={1}>{entry.remark}</Text>
                        <Text style={s.entrySub} numberOfLines={1}>
                          {entry.payer.name || 'Trekker'} paid · {formatWhen(entry.created_at)}
                        </Text>
                      </View>
                      <Text style={s.entryAmount}>{formatAmount(entry.amount)}</Text>
                      {entry.addedBy === currentUserId && (
                        <TouchableOpacity
                          onPress={() => handleDelete(entry)}
                          disabled={deletingId === entry.id}
                          style={s.entryDelete}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={`Remove "${entry.remark}"`}>
                          {deletingId === entry.id ? (
                            <ActivityIndicator size="small" color={C.red} />
                          ) : (
                            <Trash2 size={15} color={C.textFaint} strokeWidth={2} />
                          )}
                        </TouchableOpacity>
                      )}
                    </View>
                  ))
                )}

                <Text style={s.sectionLabel}>Log an Expense</Text>
                <View style={s.form}>
                  <Text style={s.formLabel}>Who paid?</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.payerRow}>
                    {room.members.map(member => {
                      const selected = member.id === payerId;
                      return (
                        <TouchableOpacity
                          key={member.id}
                          onPress={() => setPayerId(member.id)}
                          style={s.payerOption}
                          accessibilityRole="button"
                          accessibilityLabel={`Paid by ${member.name || 'Trekker'}`}>
                          <View style={[s.payerAvatarWrap, selected && s.payerAvatarWrapSelected]}>
                            <Avatar uri={member.profilePicture} initials={member.name} size={40} />
                            {selected && (
                              <View style={s.payerCheck}>
                                <Check size={11} color={C.white} strokeWidth={3} />
                              </View>
                            )}
                          </View>
                          <Text style={s.payerName} numberOfLines={1}>{member.name || 'Trekker'}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  <Text style={s.formLabel}>What for?</Text>
                  <TextInput
                    style={s.input}
                    value={remark}
                    onChangeText={setRemark}
                    placeholder="Teahouse dinner, permit fee, taxi…"
                    placeholderTextColor={C.textFaint}
                    maxLength={200}
                  />

                  <Text style={s.formLabel}>Amount</Text>
                  <TextInput
                    style={s.input}
                    value={amountText}
                    onChangeText={setAmountText}
                    placeholder="0"
                    placeholderTextColor={C.textFaint}
                    keyboardType="decimal-pad"
                  />

                  {formError !== '' && <Text style={s.formError}>{formError}</Text>}

                  <TouchableOpacity
                    onPress={handleAdd}
                    disabled={!canSubmit || submitting}
                    style={[s.submitBtn, (!canSubmit || submitting) && s.submitBtnDisabled]}
                    accessibilityRole="button"
                    accessibilityLabel="Add expense">
                    {submitting ? (
                      <ActivityIndicator size="small" color={C.white} />
                    ) : (
                      <Text style={s.submitBtnText}>Add Expense</Text>
                    )}
                  </TouchableOpacity>
                </View>

                <View style={{ height: 24 }} />
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1 },
  overlayFill: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 22,
    paddingTop: 14,
    maxHeight: '86%',
    borderTopWidth: 1,
    borderColor: C.border,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
    alignSelf: 'center',
    marginBottom: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 12,
  },
  title: { color: C.white, fontSize: 19, fontWeight: '700' },
  subtitle: { color: C.textFaint, fontSize: 12, marginTop: 2 },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingBox: { paddingVertical: 60, alignItems: 'center' },

  sectionLabel: {
    color: C.textFaint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginTop: 18,
    marginBottom: 12,
  },

  summaryRow: { flexGrow: 0 },
  summaryChip: {
    alignItems: 'center',
    width: 82,
    marginRight: 12,
    backgroundColor: C.elevated,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 10,
    paddingHorizontal: 6,
  },
  summaryName: { color: C.white, fontSize: 11, fontWeight: '600', marginTop: 6 },
  summaryAmount: { color: C.green, fontSize: 11, fontWeight: '700', marginTop: 2 },

  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    backgroundColor: C.elevated,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    gap: 8,
  },
  emptyText: { color: C.textFaint, fontSize: 12 },

  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  entryInfo: { flex: 1 },
  entryRemark: { color: C.white, fontSize: 14, fontWeight: '600' },
  entrySub: { color: C.textFaint, fontSize: 11, marginTop: 2 },
  entryAmount: { color: C.white, fontSize: 13, fontWeight: '700' },
  entryDelete: { padding: 4 },

  form: {
    backgroundColor: C.elevated,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
  },
  formLabel: { color: C.textSub, fontSize: 12, fontWeight: '600', marginBottom: 8, marginTop: 4 },
  payerRow: { flexGrow: 0, marginBottom: 4 },
  payerOption: { alignItems: 'center', width: 58, marginRight: 10 },
  payerAvatarWrap: { borderRadius: 22, padding: 2 },
  payerAvatarWrapSelected: { borderWidth: 2, borderColor: C.brand },
  payerCheck: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: C.brand,
    borderWidth: 2,
    borderColor: C.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  payerName: { color: C.textSub, fontSize: 10, marginTop: 4 },
  input: {
    height: 44,
    borderWidth: 1,
    borderRadius: 12,
    borderColor: C.border,
    backgroundColor: C.surface,
    paddingHorizontal: 14,
    color: C.white,
    fontSize: 14,
    marginBottom: 4,
  },
  formError: { color: C.red, fontSize: 12, marginTop: 6 },
  submitBtn: {
    backgroundColor: C.brand,
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 14,
  },
  submitBtnDisabled: { opacity: 0.4 },
  submitBtnText: { color: C.white, fontSize: 14, fontWeight: '700' },
});
