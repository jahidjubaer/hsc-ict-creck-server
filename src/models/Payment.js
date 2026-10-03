import mongoose from 'mongoose';
import { PLAN_KEYS } from '../config/plans.js';

export const PAYMENT_METHODS = ['bkash', 'nagad'];
export const PAYMENT_STATUSES = ['pending', 'approved', 'rejected'];

// One manual bKash/Nagad "Send Money" submission. An admin checks the TrxID in the wallet app and approves or rejects it.
const paymentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    plan: { type: String, enum: PLAN_KEYS, required: true },
    months: { type: Number, required: true },
    amount: { type: Number, required: true }, // price at the time of submission (BDT)
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    payTo: { type: String }, // our number shown to the student when they paid
    senderNumber: { type: String, required: true },
    trxId: { type: String, required: true, unique: true, uppercase: true, trim: true },
    status: { type: String, enum: PAYMENT_STATUSES, default: 'pending', index: true },
    rejectReason: { type: String },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    // Subscription period this payment bought (set on approval)
    periodStart: { type: Date },
    periodEnd: { type: Date },
  },
  { timestamps: true }
);

paymentSchema.index({ status: 1, createdAt: 1 });

paymentSchema.methods.toPublic = function toPublic() {
  return {
    _id: this._id,
    plan: this.plan,
    months: this.months,
    amount: this.amount,
    method: this.method,
    senderNumber: this.senderNumber,
    trxId: this.trxId,
    status: this.status,
    rejectReason: this.rejectReason,
    reviewedAt: this.reviewedAt,
    periodStart: this.periodStart,
    periodEnd: this.periodEnd,
    createdAt: this.createdAt,
  };
};

export const Payment = mongoose.model('Payment', paymentSchema);
