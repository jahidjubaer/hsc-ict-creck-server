import mongoose from 'mongoose';

// Who did what in the admin panel (payment decisions, subscription changes, question edits).
const adminLogSchema = new mongoose.Schema(
  {
    admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true }, // payment.approve | payment.reject | user.extend | user.cancel | question.edit | ai.review | settings.payment
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }, // affected student, if any
    ref: { type: mongoose.Schema.Types.ObjectId }, // payment / question / attempt id
    details: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const AdminLog = mongoose.model('AdminLog', adminLogSchema);

export const logAdmin = (req, action, { user, ref, details } = {}) =>
  AdminLog.create({ admin: req.user._id, action, user, ref, details });
