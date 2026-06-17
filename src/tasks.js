// Task state machine
// discussing -> planning -> confirming -> executing -> reviewing -> done
//                    ^                             ^
//               User确认                        User审核
//  User驳回可回退到 discussing                 User驳回可回退到 planning

const VALID_TRANSITIONS = {
  discussing: ['planning'],
  planning: ['confirming', 'discussing'],
  confirming: ['executing', 'discussing'],
  executing: ['reviewing', 'planning'],
  reviewing: ['done', 'planning'],
  done: [],
  cancelled: [],
};

const STATUS_LABELS = {
  discussing: '讨论中',
  planning: '规划中',
  confirming: '待确认',
  executing: '执行中',
  reviewing: '待审核',
  done: '已完成',
  cancelled: '已取消',
};

const REVIEW_GATES = ['confirming', 'reviewing'];

function canTransition(from, to) {
  return VALID_TRANSITIONS[from]?.includes(to) || false;
}

function isReviewGate(status) {
  return REVIEW_GATES.includes(status);
}

function getNextStatus(current, action) {
  switch (action) {
    case 'plan_ready': return 'confirming';
    case 'confirm':    return current === 'confirming' ? 'executing' : null;
    case 'reject':     return current === 'confirming' ? 'discussing' : 'planning';
    case 'result_ready': return 'reviewing';
    case 'approve':    return current === 'reviewing' ? 'done' : null;
    case 'cancel':     return 'cancelled';
    default:           return null;
  }
}

module.exports = { VALID_TRANSITIONS, STATUS_LABELS, canTransition, isReviewGate, getNextStatus };
