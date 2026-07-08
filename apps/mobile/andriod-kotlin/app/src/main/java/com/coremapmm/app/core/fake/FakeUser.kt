package com.coremapmm.app.core.fake

import com.coremapmm.app.core.model.UserUiModel

object FakeUser {
  val signedInUser: UserUiModel = UserUiModel(
    name = "Nyi Htet",
    levelText = "Explorer · Level 3",
    pointsText = "1,240 points",
    isGuest = false,
  )

  val guestUser: UserUiModel = UserUiModel(
    name = "Guest",
    levelText = "Sign in to save places",
    pointsText = "—",
    isGuest = true,
  )

  val currentUser: UserUiModel = signedInUser
}
