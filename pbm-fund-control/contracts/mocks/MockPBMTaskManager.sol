// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.13;

import "../interfaces/IPBMTaskManager.sol";
import "../interfaces/PBMTaskManagerErrors.sol";

contract MockPBMTaskManager is IPBMTaskManager, PBMTaskManagerErrors {
    event TaskCreated();

    event TaskCancelled();

    constructor() {}

    function createWithdrawalTask(address /*payee*/, uint256 /*depositId*/) external {
        emit TaskCreated();
    }

    function execWithdrawal(
        address /*payee*/,
        uint256 /*depositId*/
    ) external returns (bool success) {
        success = true;

        emit WithdrawalTaskExecution(0, success);
    }

    function cancelWithdrawalTask(uint256 /*depositId*/) external returns (bool) {
        emit TaskCancelled();
        return true;
    }

    function getTaskId(uint256 /*depositId*/) public pure returns (bytes32) {
        return 0;
    }
}
